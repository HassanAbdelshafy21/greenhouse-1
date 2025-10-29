#include <ESP8266WiFi.h>
#include <ESP8266WebServer.h>
#include <DHT.h>
#include <AccelStepper.h>
#include <EEPROM.h>

// WiFi credentials
const char* ssid = "SmartHomeX11";
const char* password = "x11smart123";

// ESP8266 GPIO pin definitions
#define RELAY_FAN   5   // GPIO5 (D1)
#define RELAY_PUMP1 4   // GPIO4 (D2)
#define RELAY_PUMP2 14  // GPIO14 (D5)
#define RELAY_LED   12  // GPIO12 (D6)

// Sensor Pins
#define DHTPIN 2        // GPIO2 (D4)
#define DHTTYPE DHT22
#define PHSENSORPIN A0  // Analog pin
#define TRIG 0          // GPIO0 (D3)
#define ECHO 13         // GPIO13 (D7)

// Stepper Motor Pins
#define STEP_PIN 15     // GPIO15 (D8)
#define DIR_PIN  3      // GPIO3 (RX)
#define EN_PIN   1      // GPIO1 (TX)

ESP8266WebServer server(80);
DHT dht(DHTPIN, DHTTYPE);
AccelStepper stepper(AccelStepper::DRIVER, STEP_PIN, DIR_PIN);

// Device states
bool fanState = false;
bool pump1State = false;
bool pump2State = false;
bool ledState = false;

// Sensor data
float temperature = 0.0;
float humidity = 0.0;
int phValue = 0;
float distance = 0.0;

// Motor parameters
const int motorStepsPerRev = 200;
const int microsteps = 16;
const float leadScrewPitch = 8.0; // TR8x8 = 8mm/rev

// Soft limits (mm) - 10cm in each direction from center
const float MIN_MM = -100.0;
const float MAX_MM = 100.0;

float stepsPerMM;
long targetSteps;
bool goingForward = false;

// Stepper control variables
bool stepperEnabled = true;
bool autoMode = true;

// EEPROM addresses
const int EEPROM_ADDR = 0;
const int EEPROM_MAGIC_ADDR = 4;
const int EEPROM_DIRECTION_ADDR = 8;
const int EEPROM_TARGET_ADDR = 12;
const long EEPROM_MAGIC_NUMBER = 0x12345678;

// WiFi reconnection variables
unsigned long lastWiFiCheck = 0;
const unsigned long WIFI_CHECK_INTERVAL = 30000;

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

float calculateMoveTime(long steps) {
  float maxSpeed = 3000.0;
  float acceleration = 2000.0;

  float timeToMaxSpeed = maxSpeed / acceleration;
  float stepsToMaxSpeed = 0.5 * acceleration * timeToMaxSpeed * timeToMaxSpeed;

  if (steps <= 2 * stepsToMaxSpeed) {
    float peakSpeed = sqrt(steps * acceleration);
    return 2 * (peakSpeed / acceleration);
  } else {
    float constantSpeedSteps = steps - (2 * stepsToMaxSpeed);
    float constantSpeedTime = constantSpeedSteps / maxSpeed;
    return (2 * timeToMaxSpeed) + constantSpeedTime;
  }
}

void readSensors() {
  // DHT22
  float h = dht.readHumidity();
  float t = dht.readTemperature();

  if (!isnan(h)) humidity = h;
  if (!isnan(t)) temperature = t;

  // PH Sensor
  phValue = analogRead(PHSENSORPIN);

  // Ultrasonic
  digitalWrite(TRIG, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIG, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG, LOW);
  long duration = pulseIn(ECHO, HIGH);
  float dist = duration * 0.034 / 2;

  if (!isnan(dist) && dist >= 0 && dist <= 400) {
    distance = dist;
  }
}

void handleStatus() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.sendHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  server.sendHeader("Access-Control-Allow-Headers", "Content-Type");

  String json = "{";
  json += "\"temperature\":" + String(temperature);
  json += ",\"humidity\":" + String(humidity);
  json += ",\"ph\":" + String(phValue);
  json += ",\"distance\":" + String(distance);
  json += ",\"stepper_position\":" + String(stepper.currentPosition());
  json += ",\"fan\":\"" + String(fanState ? "1" : "0") + "\"";
  json += ",\"pump1\":\"" + String(pump1State ? "1" : "0") + "\"";
  json += ",\"pump2\":\"" + String(pump2State ? "1" : "0") + "\"";
  json += ",\"led\":\"" + String(ledState ? "1" : "0") + "\"";
  json += ",\"stepper_enabled\":\"" + String(stepperEnabled ? "1" : "0") + "\"";
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
      stepper.stop();
      autoMode = false;
      Serial.println("Stepper DISABLED");
    }
  }
  if (server.hasArg("stepper_move")) {
    if (!stepperEnabled) {
      server.send(400, "text/plain", "Stepper disabled");
      return;
    }
    String moveDir = server.arg("stepper_move");
    autoMode = false;
    if (moveDir == "left") {
      stepper.move(-1000);
      Serial.println("Moving LEFT");
    } else if (moveDir == "right") {
      stepper.move(1000);
      Serial.println("Moving RIGHT");
    } else if (moveDir == "home") {
      stepper.moveTo(0);
      Serial.println("Moving to HOME");
    }
  }
  if (server.hasArg("stepper_position")) {
    if (!stepperEnabled) {
      server.send(400, "text/plain", "Stepper disabled");
      return;
    }
    autoMode = false;
    long targetPos = server.arg("stepper_position").toInt();
    stepper.moveTo(targetPos);
    Serial.print("Moving to position: ");
    Serial.println(targetPos);
  }
  if (server.hasArg("stepper_speed")) {
    long speed = server.arg("stepper_speed").toInt();
    stepper.setMaxSpeed(speed);
    Serial.print("Speed set to: ");
    Serial.println(speed);
  }
  if (server.hasArg("stepper_acceleration")) {
    long accel = server.arg("stepper_acceleration").toInt();
    stepper.setAcceleration(accel);
    Serial.print("Acceleration set to: ");
    Serial.println(accel);
  }
  if (server.hasArg("stepper_stop")) {
    stepper.stop();
    autoMode = false;
    Serial.println("Stepper STOPPED");
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

  // Initialize EEPROM (ESP8266 needs explicit size)
  EEPROM.begin(512);

  // Initialize DHT sensor
  dht.begin();

  // Setup relay pins
  pinMode(RELAY_FAN, OUTPUT);
  pinMode(RELAY_PUMP1, OUTPUT);
  pinMode(RELAY_PUMP2, OUTPUT);
  pinMode(RELAY_LED, OUTPUT);

  digitalWrite(RELAY_FAN, HIGH);
  digitalWrite(RELAY_PUMP1, HIGH);
  digitalWrite(RELAY_PUMP2, HIGH);
  digitalWrite(RELAY_LED, HIGH);

  // Setup ultrasonic sensor pins
  pinMode(TRIG, OUTPUT);
  pinMode(ECHO, INPUT);

  // Setup stepper motor pins
  pinMode(EN_PIN, OUTPUT);
  pinMode(STEP_PIN, OUTPUT);
  pinMode(DIR_PIN, OUTPUT);

  digitalWrite(EN_PIN, LOW);
  digitalWrite(STEP_PIN, LOW);
  digitalWrite(DIR_PIN, LOW);

  Serial.println("=== ESP8266 Combined Greenhouse Controller ===");

  // Initialize stepper
  stepsPerMM = (motorStepsPerRev * microsteps) / leadScrewPitch;
  Serial.print("Steps per mm = ");
  Serial.println(stepsPerMM);

  stepper.setMaxSpeed(3000);
  stepper.setAcceleration(2000);

  // Restore stepper state from EEPROM
  long currentPos, savedTarget;
  bool savedDirection;
  bool wasRestored = readStateFromEEPROM(&currentPos, &savedTarget, &savedDirection);

  stepper.setCurrentPosition(currentPos);
  targetSteps = savedTarget;
  goingForward = savedDirection;

  Serial.print("Motor position set to: ");
  Serial.print((float)currentPos / stepsPerMM);
  Serial.println("mm");

  if (wasRestored) {
    Serial.println("CONTINUING previous movement");
    stepper.moveTo(targetSteps);
  }

  // Connect to WiFi
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.persistent(true);
  connectToWiFi();

  // Setup web server routes
  server.on("/api/status", HTTP_GET, handleStatus);
  server.on("/api/status", HTTP_OPTIONS, handleCORS);
  server.on("/api/control", HTTP_GET, handleControl);
  server.on("/api/control", HTTP_OPTIONS, handleCORS);
  server.begin();

  Serial.println("HTTP server started");
  Serial.println("Ready!");
}

void loop() {
  // Handle web server
  server.handleClient();

  // Check WiFi connection periodically
  unsigned long currentTime = millis();
  if (currentTime - lastWiFiCheck >= WIFI_CHECK_INTERVAL) {
    lastWiFiCheck = currentTime;

    if (WiFi.status() != WL_CONNECTED) {
      Serial.println("WiFi disconnected. Reconnecting...");
      connectToWiFi();
    } else {
      int rssi = WiFi.RSSI();
      Serial.print("WiFi RSSI: ");
      Serial.print(rssi);
      Serial.println(" dBm");

      if (rssi < -70) {
        Serial.println("Warning: Weak WiFi signal!");
      }
    }
  }

  // Read sensors periodically
  static unsigned long lastSensorRead = 0;
  if (millis() - lastSensorRead > 2000) {
    readSensors();
    lastSensorRead = millis();

    Serial.print("Temp: ");
    Serial.print(temperature);
    Serial.print("C, Hum: ");
    Serial.print(humidity);
    Serial.print("%, PH: ");
    Serial.print(phValue);
    Serial.print(", Dist: ");
    Serial.print(distance);
    Serial.println("cm");
  }

  // Stepper motor control - auto mode
  if (stepperEnabled && autoMode && !stepper.isRunning()) {
    Serial.println("--- Setting new target (AUTO MODE) ---");

    if (goingForward) {
      targetSteps = MAX_MM * stepsPerMM;
      Serial.print("Moving RIGHT to: ");
      Serial.print(MAX_MM);
      Serial.println("mm");
    } else {
      targetSteps = MIN_MM * stepsPerMM;
      Serial.print("Moving LEFT to: ");
      Serial.print(MIN_MM);
      Serial.println("mm");
    }

    stepper.moveTo(targetSteps);
    goingForward = !goingForward;

    long dist = abs(targetSteps - stepper.currentPosition());
    float distMM = (float)dist / stepsPerMM;
    float estimatedTime = calculateMoveTime(dist);
    Serial.print("Distance: ");
    Serial.print(distMM);
    Serial.print("mm, Est. time: ");
    Serial.print(estimatedTime);
    Serial.println("s");
  }

  // Run stepper if enabled
  if (stepperEnabled) {
    stepper.run();
  }

  // Debug stepper progress
  static unsigned long lastDebug = 0;
  if (millis() - lastDebug > 1000) {
    if (stepper.isRunning()) {
      Serial.print("Pos: ");
      Serial.print((float)stepper.currentPosition() / stepsPerMM);
      Serial.print("mm → Target: ");
      Serial.print((float)targetSteps / stepsPerMM);
      Serial.print("mm, Speed: ");
      Serial.print(stepper.speed());
      Serial.println(" steps/s");
    }
    lastDebug = millis();
  }

  // Save state periodically to EEPROM
  static unsigned long lastSave = 0;
  static long lastSavedPosition = 0;

  if (millis() - lastSave > 2000) {
    long currentPos = stepper.currentPosition();
    if (abs(currentPos - lastSavedPosition) > 10) {
      saveStateToEEPROM(currentPos, targetSteps, goingForward);
      lastSavedPosition = currentPos;
    }
    lastSave = millis();
  }

  // Small delay
  delay(10);
}
