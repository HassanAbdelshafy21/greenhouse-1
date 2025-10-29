#include <ESP8266WiFi.h>
#include <ESP8266WebServer.h>
#include <EEPROM.h>

// Relay pins
#define RELAY_FAN   5   // GPIO5
#define RELAY_PUMP1 4   // GPIO4
#define RELAY_PUMP2 14  // GPIO14
#define RELAY_LED   12  // GPIO12

// TMC2209 STEP/DIR pins (no UART)
#define STEP_PIN    13  // GPIO13
#define DIR_PIN     15  // GPIO15
#define EN_PIN      0   // GPIO0

// WiFi credentials
const char* ssid = "SmartHomeX11";
const char* password = "x11smart123";

ESP8266WebServer server(80);

// Motor parameters
const int motorStepsPerRev = 200;
const int microsteps = 16;
const float leadScrewPitch = 8.0; // TR8x8 = 8mm/rev

// Soft limits (mm) - 10cm in each direction from center
const float MIN_MM = -100.0;
const float MAX_MM = 100.0;

float stepsPerMM;
long currentPosition = 0;
long targetPosition = 0;
bool goingForward = false;
bool isMoving = false;

// Stepper control variables
bool stepperEnabled = true;
bool autoMode = true;
unsigned long lastStepTime = 0;
float currentSpeed = 0;
float maxSpeed = 3000.0; // steps/sec
float acceleration = 2000.0; // steps/sec^2

// Device states
bool fanState = false;
bool pump1State = false;
bool pump2State = false;
bool ledState = false;

// WiFi reconnection variables
unsigned long lastWiFiCheck = 0;
const unsigned long WIFI_CHECK_INTERVAL = 30000;

// EEPROM addresses
const int EEPROM_SIZE = 512;
const int EEPROM_ADDR = 0;
const int EEPROM_MAGIC_ADDR = 4;
const int EEPROM_DIRECTION_ADDR = 8;
const int EEPROM_TARGET_ADDR = 12;
const long EEPROM_MAGIC_NUMBER = 0x12345678;

void saveStateToEEPROM(long currentPos, long targetPos, bool direction) {
  EEPROM.put(EEPROM_ADDR, currentPos);
  EEPROM.put(EEPROM_TARGET_ADDR, targetPos);
  EEPROM.put(EEPROM_DIRECTION_ADDR, direction);
  EEPROM.put(EEPROM_MAGIC_ADDR, EEPROM_MAGIC_NUMBER);
  EEPROM.commit();
  Serial.print("Saved state - Pos: ");
  Serial.print((float)currentPos / stepsPerMM);
  Serial.print("mm, Target: ");
  Serial.print((float)targetPos / stepsPerMM);
  Serial.print("mm, Dir: ");
  Serial.println(direction ? "RIGHT" : "LEFT");
}

bool readStateFromEEPROM(long* currentPos, long* targetPos, bool* direction) {
  long magicCheck;
  EEPROM.get(EEPROM_MAGIC_ADDR, magicCheck);

  if (magicCheck != EEPROM_MAGIC_NUMBER) {
    Serial.println("EEPROM not initialized - starting fresh");
    *currentPos = 0;
    *targetPos = MIN_MM * stepsPerMM;
    *direction = false;
    saveStateToEEPROM(*currentPos, *targetPos, *direction);
    return false;
  }

  EEPROM.get(EEPROM_ADDR, *currentPos);
  EEPROM.get(EEPROM_TARGET_ADDR, *targetPos);
  EEPROM.get(EEPROM_DIRECTION_ADDR, *direction);

  float savedMM = (float)*currentPos / stepsPerMM;
  if (savedMM < MIN_MM - 10 || savedMM > MAX_MM + 10) {
    Serial.println("EEPROM position out of range - resetting");
    *currentPos = 0;
    *targetPos = MIN_MM * stepsPerMM;
    *direction = false;
    saveStateToEEPROM(*currentPos, *targetPos, *direction);
    return false;
  }

  Serial.print("Restored state - Pos: ");
  Serial.print((float)*currentPos / stepsPerMM);
  Serial.print("mm, Target: ");
  Serial.print((float)*targetPos / stepsPerMM);
  Serial.print("mm, Dir: ");
  Serial.println(*direction ? "RIGHT" : "LEFT");

  return true;
}

void handleStatus() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.sendHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  server.sendHeader("Access-Control-Allow-Headers", "Content-Type");

  String json = "{";
  json += "\"fan\":\"" + String(fanState ? "1" : "0") + "\"";
  json += ",\"pump1\":\"" + String(pump1State ? "1" : "0") + "\"";
  json += ",\"pump2\":\"" + String(pump2State ? "1" : "0") + "\"";
  json += ",\"led\":\"" + String(ledState ? "1" : "0") + "\"";
  json += ",\"stepper_enabled\":\"" + String(stepperEnabled ? "1" : "0") + "\"";
  json += ",\"stepper_position\":" + String(currentPosition);
  json += ",\"stepper_position_mm\":" + String((float)currentPosition / stepsPerMM);
  json += ",\"stepper_target\":" + String(targetPosition);
  json += ",\"stepper_moving\":\"" + String(isMoving ? "1" : "0") + "\"";
  json += ",\"auto_mode\":\"" + String(autoMode ? "1" : "0") + "\"";
  json += "}";

  server.send(200, "application/json", json);
}

void handleControl() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.sendHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  server.sendHeader("Access-Control-Allow-Headers", "Content-Type");

  // Handle relay controls
  if (server.hasArg("fan")) {
    fanState = server.arg("fan") == "1";
    digitalWrite(RELAY_FAN, fanState ? LOW : HIGH);
  }
  if (server.hasArg("pump1")) {
    pump1State = server.arg("pump1") == "1";
    digitalWrite(RELAY_PUMP1, pump1State ? LOW : HIGH);
  }
  if (server.hasArg("pump2")) {
    pump2State = server.arg("pump2") == "1";
    digitalWrite(RELAY_PUMP2, pump2State ? LOW : HIGH);
  }
  if (server.hasArg("led")) {
    ledState = server.arg("led") == "1";
    digitalWrite(RELAY_LED, ledState ? LOW : HIGH);
  }

  // Handle stepper motor commands
  if (server.hasArg("stepper_enable")) {
    stepperEnabled = server.arg("stepper_enable") == "1";
    if (stepperEnabled) {
      digitalWrite(EN_PIN, LOW);
      Serial.println("Stepper ENABLED");
    } else {
      digitalWrite(EN_PIN, HIGH);
      isMoving = false;
      autoMode = false;
      Serial.println("Stepper DISABLED");
    }
  }

  if (server.hasArg("stepper_move")) {
    if (!stepperEnabled) {
      server.send(400, "text/plain", "Stepper disabled");
      return;
    }
    String direction = server.arg("stepper_move");
    autoMode = false;

    if (direction == "left") {
      targetPosition = currentPosition - 1000;
      isMoving = true;
      Serial.println("Moving LEFT (relative 1000 steps)");
    } else if (direction == "right") {
      targetPosition = currentPosition + 1000;
      isMoving = true;
      Serial.println("Moving RIGHT (relative 1000 steps)");
    } else if (direction == "home") {
      targetPosition = 0;
      isMoving = true;
      Serial.println("Moving to HOME");
    }
  }

  if (server.hasArg("stepper_position")) {
    if (!stepperEnabled) {
      server.send(400, "text/plain", "Stepper disabled");
      return;
    }
    autoMode = false;
    targetPosition = server.arg("stepper_position").toInt();
    isMoving = true;
    Serial.print("Moving to position: ");
    Serial.println(targetPosition);
  }

  if (server.hasArg("stepper_speed")) {
    maxSpeed = server.arg("stepper_speed").toFloat();
    Serial.print("Max speed set to: ");
    Serial.println(maxSpeed);
  }

  if (server.hasArg("stepper_acceleration")) {
    acceleration = server.arg("stepper_acceleration").toFloat();
    Serial.print("Acceleration set to: ");
    Serial.println(acceleration);
  }

  if (server.hasArg("stepper_stop")) {
    isMoving = false;
    autoMode = false;
    targetPosition = currentPosition;
    Serial.println("Stepper STOPPED");
  }

  if (server.hasArg("auto_mode")) {
    autoMode = server.arg("auto_mode") == "1";
    if (autoMode && stepperEnabled) {
      Serial.println("Auto mode ENABLED");
    } else {
      Serial.println("Auto mode DISABLED");
    }
  }

  server.send(200, "text/plain", "OK");
}

void handleCORS() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.sendHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  server.sendHeader("Access-Control-Allow-Headers", "Content-Type");
  server.send(200, "text/plain", "");
}

void connectToWiFi() {
  Serial.println("Connecting to WiFi...");
  WiFi.begin(ssid, password);

  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 20) {
    delay(500);
    Serial.print(".");
    attempts++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("");
    Serial.print("WiFi connected! IP: ");
    Serial.println(WiFi.localIP());
    Serial.print("Signal strength: ");
    Serial.print(WiFi.RSSI());
    Serial.println(" dBm");
  } else {
    Serial.println("");
    Serial.println("Failed to connect to WiFi");
  }
}

void setup() {
  Serial.begin(115200);

  // Initialize EEPROM
  EEPROM.begin(EEPROM_SIZE);

  // Setup relay pins
  pinMode(RELAY_FAN, OUTPUT);
  pinMode(RELAY_PUMP1, OUTPUT);
  pinMode(RELAY_PUMP2, OUTPUT);
  pinMode(RELAY_LED, OUTPUT);

  digitalWrite(RELAY_FAN, HIGH);   // OFF
  digitalWrite(RELAY_PUMP1, HIGH); // OFF
  digitalWrite(RELAY_PUMP2, HIGH); // OFF
  digitalWrite(RELAY_LED, HIGH);   // OFF

  // Setup stepper pins
  pinMode(STEP_PIN, OUTPUT);
  pinMode(DIR_PIN, OUTPUT);
  pinMode(EN_PIN, OUTPUT);
  digitalWrite(EN_PIN, LOW); // Enable driver

  Serial.println("=== ESP8266 + TMC2209 Stepper Control (STEP/DIR mode) ===");

  // Calculate steps per mm
  stepsPerMM = (motorStepsPerRev * microsteps) / leadScrewPitch;
  Serial.print("Steps per mm: ");
  Serial.println(stepsPerMM);

  // Restore position from EEPROM
  long savedTarget;
  bool savedDirection;
  readStateFromEEPROM(&currentPosition, &savedTarget, &savedDirection);
  targetPosition = savedTarget;
  goingForward = savedDirection;

  Serial.print("Current position: ");
  Serial.print((float)currentPosition / stepsPerMM);
  Serial.println("mm");

  // Connect to WiFi
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.persistent(true);
  connectToWiFi();

  // Setup HTTP server
  server.on("/api/status", HTTP_GET, handleStatus);
  server.on("/api/status", HTTP_OPTIONS, handleCORS);
  server.on("/api/control", HTTP_GET, handleControl);
  server.on("/api/control", HTTP_OPTIONS, handleCORS);
  server.begin();

  Serial.println("HTTP server started");
  Serial.print("Movement range: ");
  Serial.print(MIN_MM);
  Serial.print("mm to ");
  Serial.print(MAX_MM);
  Serial.println("mm");
}

void runStepper() {
  if (!stepperEnabled || !isMoving) return;

  unsigned long currentTime = micros();
  long stepsRemaining = targetPosition - currentPosition;

  if (stepsRemaining == 0) {
    isMoving = false;
    currentSpeed = 0;
    Serial.println("Target reached");
    return;
  }

  // Calculate acceleration/deceleration
  float distance = abs(stepsRemaining);
  float decelDistance = (currentSpeed * currentSpeed) / (2.0 * acceleration);

  if (distance <= decelDistance) {
    // Decelerate
    currentSpeed -= acceleration * (currentTime - lastStepTime) / 1000000.0;
    if (currentSpeed < 100) currentSpeed = 100; // Minimum speed
  } else {
    // Accelerate
    currentSpeed += acceleration * (currentTime - lastStepTime) / 1000000.0;
    if (currentSpeed > maxSpeed) currentSpeed = maxSpeed;
  }

  // Calculate step interval
  unsigned long stepInterval = 1000000.0 / currentSpeed;

  if (currentTime - lastStepTime >= stepInterval) {
    // Set direction
    digitalWrite(DIR_PIN, stepsRemaining > 0 ? HIGH : LOW);

    // Step pulse
    digitalWrite(STEP_PIN, HIGH);
    delayMicroseconds(5);
    digitalWrite(STEP_PIN, LOW);

    // Update position
    currentPosition += (stepsRemaining > 0) ? 1 : -1;
    lastStepTime = currentTime;
  }
}

void loop() {
  // Handle web server
  server.handleClient();

  // Check WiFi connection
  unsigned long currentTime = millis();
  if (currentTime - lastWiFiCheck >= WIFI_CHECK_INTERVAL) {
    lastWiFiCheck = currentTime;

    if (WiFi.status() != WL_CONNECTED) {
      Serial.println("WiFi disconnected. Reconnecting...");
      connectToWiFi();
    }
  }

  // Auto mode - set new target when reached
  if (stepperEnabled && autoMode && !isMoving) {
    if (goingForward) {
      targetPosition = MAX_MM * stepsPerMM;
      Serial.print("Auto mode: Moving RIGHT to ");
      Serial.print(MAX_MM);
      Serial.println("mm");
    } else {
      targetPosition = MIN_MM * stepsPerMM;
      Serial.print("Auto mode: Moving LEFT to ");
      Serial.print(MIN_MM);
      Serial.println("mm");
    }
    goingForward = !goingForward;
    isMoving = true;
  }

  // Run stepper motor
  runStepper();

  // Save state periodically
  static unsigned long lastSave = 0;
  static long lastSavedPosition = 0;

  if (millis() - lastSave > 2000) {
    if (abs(currentPosition - lastSavedPosition) > 10) {
      saveStateToEEPROM(currentPosition, targetPosition, goingForward);
      lastSavedPosition = currentPosition;
    }
    lastSave = millis();
  }

  // Debug output
  static unsigned long lastDebug = 0;
  if (millis() - lastDebug > 1000) {
    if (isMoving) {
      Serial.print("Pos: ");
      Serial.print((float)currentPosition / stepsPerMM);
      Serial.print("mm → Target: ");
      Serial.print((float)targetPosition / stepsPerMM);
      Serial.print("mm, Speed: ");
      Serial.print(currentSpeed);
      Serial.println(" steps/s");
    }
    lastDebug = millis();
  }

  yield(); // Let ESP8266 handle WiFi tasks
}
