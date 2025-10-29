#include <WiFi.h>
#include <WebServer.h>
#include <DHT.h>
#include <AccelStepper.h>
#include <EEPROM.h>

// WiFi credentials
const char* ssid = "SmartHomeX11";
const char* password = "x11smart123";

// ESP32 GPIO pin definitions
#define RELAY_FAN   5   // GPIO5
#define RELAY_PUMP1 4   // GPIO4
#define RELAY_PUMP2 14  // GPIO14
#define RELAY_LED   12  // GPIO12

// Sensor Pins
#define DHTPIN 2        // GPIO2
#define DHTTYPE DHT22
#define PHSENSORPIN 34  // ADC1_CH6 (GPIO34)
#define TRIG 0          // GPIO0
#define ECHO 13         // GPIO13

// Stepper Motor Pins (TMC2209) - Optimal pin selection
#define STEP_PIN 25     // GPIO25 - Clean GPIO, no conflicts
#define DIR_PIN  26     // GPIO26 - Clean GPIO, no conflicts
#define EN_PIN   27     // GPIO27 - Clean GPIO, no conflicts
#define MS1_PIN  32     // GPIO32 - Microstep select 1
#define MS2_PIN  33     // GPIO33 - Microstep select 2

WebServer server(80);
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
const int motorStepsPerRev = 200;      // Standard NEMA stepper = 200 steps/rev (1.8° per step)
const int microsteps = 1;              // Full step mode for MAXIMUM torque
const float leadScrewPitch = 4.0;      // TR8x4 = 4mm per revolution

// Soft limits (mm) - 10cm in each direction from center
const float MIN_MM = -100.0;
const float MAX_MM = 100.0;

float stepsPerMM;
long targetSteps;
bool goingForward = false;

// Stepper control variables
bool stepperEnabled = false;
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

// Set microstepping mode
void setMicrostepping(int mode) {
  switch(mode) {
    case 1: // Full step
      digitalWrite(MS1_PIN, LOW);
      digitalWrite(MS2_PIN, LOW);
      break;
    case 2: // 1/2 step
      digitalWrite(MS1_PIN, HIGH);
      digitalWrite(MS2_PIN, LOW);
      break;
    case 4: // 1/4 step
      digitalWrite(MS1_PIN, LOW);
      digitalWrite(MS2_PIN, HIGH);
      break;
    case 8: // 1/8 step (if supported)
      digitalWrite(MS1_PIN, HIGH);
      digitalWrite(MS2_PIN, HIGH);
      break;
    case 16: // 1/16 step
      digitalWrite(MS1_PIN, HIGH);
      digitalWrite(MS2_PIN, HIGH);
      break;
  }
  Serial.print("Microstepping set to 1/");
  Serial.println(mode);
  delay(10);  // Let pins settle
}

// Enable/disable stepper motor
void enableStepper(bool enable) {
  digitalWrite(EN_PIN, enable ? LOW : HIGH);
  stepperEnabled = enable;
  Serial.print("Stepper ");
  Serial.println(enable ? "ENABLED" : "DISABLED");
}

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
  json += ",\"stepper_auto\":\"" + String(autoMode ? "1" : "0") + "\"";
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
      Serial.println("WARNING: Enabling stepper - ensure adequate 12V power supply!");
      delay(100);  // Give system time to stabilize
      digitalWrite(EN_PIN, LOW);
      delay(50);   // Wait for driver to energize
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
      Serial.println("========================================");
      Serial.println(">>> LEFT BUTTON PRESSED <<<");
      Serial.println("MOVING 200 STEPS LEFT - WATCH THE MOTOR!");
      Serial.println("========================================");

      // Set direction to LEFT
      digitalWrite(DIR_PIN, LOW);
      delay(10);

      // Generate 200 step pulses
      for (int i = 0; i < 200; i++) {
        digitalWrite(STEP_PIN, HIGH);
        delayMicroseconds(10);
        digitalWrite(STEP_PIN, LOW);
        delay(5);  // 5ms = slow and visible

        if (i % 50 == 0) {
          Serial.print("Step: ");
          Serial.println(i);
        }
      }

      Serial.println("LEFT movement COMPLETE!");
      Serial.println("========================================");

    } else if (moveDir == "right") {
      Serial.println("========================================");
      Serial.println(">>> RIGHT BUTTON PRESSED <<<");
      Serial.println("MOVING 200 STEPS RIGHT - WATCH THE MOTOR!");
      Serial.println("========================================");

      // Set direction to RIGHT
      digitalWrite(DIR_PIN, HIGH);
      delay(10);

      // Generate 200 step pulses
      for (int i = 0; i < 200; i++) {
        digitalWrite(STEP_PIN, HIGH);
        delayMicroseconds(10);
        digitalWrite(STEP_PIN, LOW);
        delay(5);  // 5ms = slow and visible

        if (i % 50 == 0) {
          Serial.print("Step: ");
          Serial.println(i);
        }
      }

      Serial.println("RIGHT movement COMPLETE!");
      Serial.println("========================================");
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
  if (server.hasArg("stepper_auto")) {
    autoMode = server.arg("stepper_auto") == "1";
    if (autoMode) {
      Serial.println("AUTO MODE ENABLED");
    } else {
      Serial.println("AUTO MODE DISABLED");
    }
  }

  // DIRECT STEP TEST - bypasses AccelStepper completely
  if (server.hasArg("direct_step")) {
    if (!stepperEnabled) {
      server.send(400, "text/plain", "Stepper disabled");
      return;
    }

    int steps = server.arg("direct_step").toInt();
    Serial.print("DIRECT STEPPING: ");
    Serial.print(steps);
    Serial.println(" steps");

    // Set direction
    digitalWrite(DIR_PIN, steps > 0 ? HIGH : LOW);
    delay(10);

    // Generate step pulses manually
    for (int i = 0; i < abs(steps); i++) {
      digitalWrite(STEP_PIN, HIGH);
      delayMicroseconds(10);
      digitalWrite(STEP_PIN, LOW);
      delay(5);  // 5ms = 200 steps/sec

      if (i % 50 == 0) {
        Serial.print("Step ");
        Serial.println(i);
      }
    }

    Serial.println("DIRECT STEP COMPLETE");
    server.send(200, "text/plain", "Direct step complete");
    return;
  }

  server.send(200, "text/plain", "OK");
}

void handleCORS() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.sendHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  server.sendHeader("Access-Control-Allow-Headers", "Content-Type");
  server.send(200, "text/plain", "");
}

void handleTest() {
  server.sendHeader("Access-Control-Allow-Origin", "*");

  Serial.println("\n");
  Serial.println("╔════════════════════════════════════════════╗");
  Serial.println("║   COMPREHENSIVE MOTOR DIAGNOSTIC TEST      ║");
  Serial.println("╚════════════════════════════════════════════╝");
  Serial.println();

  // Test 1: Pin States
  Serial.println("TEST 1: Checking Pin Connections");
  Serial.println("─────────────────────────────────");
  Serial.print("EN_PIN (GPIO27):   "); Serial.println(digitalRead(EN_PIN) == HIGH ? "HIGH (Disabled)" : "LOW (Enabled)");
  Serial.print("STEP_PIN (GPIO25): "); Serial.println(digitalRead(STEP_PIN) == HIGH ? "HIGH" : "LOW");
  Serial.print("DIR_PIN (GPIO26):  "); Serial.println(digitalRead(DIR_PIN) == HIGH ? "HIGH" : "LOW");
  Serial.print("MS1_PIN (GPIO32):  "); Serial.println(digitalRead(MS1_PIN) == HIGH ? "HIGH" : "LOW");
  Serial.print("MS2_PIN (GPIO33):  "); Serial.println(digitalRead(MS2_PIN) == HIGH ? "HIGH" : "LOW");
  Serial.println();

  // Test 2: Enable Driver
  Serial.println("TEST 2: Enabling Driver");
  Serial.println("─────────────────────────────────");
  Serial.println("Setting EN_PIN LOW...");
  digitalWrite(EN_PIN, LOW);
  delay(500);
  Serial.println("✓ Driver should be energized");
  Serial.println("→ Motor should feel HARD to turn by hand");
  Serial.println();
  delay(2000);

  // Test 3: Direction Pin Toggle
  Serial.println("TEST 3: Testing Direction Pin");
  Serial.println("─────────────────────────────────");
  Serial.println("Toggling DIR_PIN...");
  digitalWrite(DIR_PIN, LOW);
  delay(500);
  Serial.println("DIR = LOW");
  digitalWrite(DIR_PIN, HIGH);
  delay(500);
  Serial.println("DIR = HIGH");
  Serial.println("✓ Direction pin working");
  Serial.println();

  // Test 4: VERY SLOW Steps (One Direction)
  Serial.println("TEST 4: 50 Steps Forward (VERY SLOW)");
  Serial.println("─────────────────────────────────");
  Serial.println("Direction: FORWARD (DIR=HIGH)");
  Serial.println("Speed: 2 steps/second");
  Serial.println("⚠️  WATCH THE MOTOR SHAFT!");
  Serial.println();

  digitalWrite(DIR_PIN, HIGH);
  delay(100);

  for (int i = 0; i < 50; i++) {
    digitalWrite(STEP_PIN, HIGH);
    delayMicroseconds(10);
    digitalWrite(STEP_PIN, LOW);
    delay(500);  // 500ms = 2 steps/second (VERY SLOW!)

    if (i % 10 == 0) {
      Serial.print("  Step: "); Serial.println(i);
    }
  }
  Serial.println("✓ Forward test complete");
  Serial.println();
  delay(1000);

  // Test 5: VERY SLOW Steps (Other Direction)
  Serial.println("TEST 5: 50 Steps Backward (VERY SLOW)");
  Serial.println("─────────────────────────────────");
  Serial.println("Direction: BACKWARD (DIR=LOW)");
  Serial.println("Speed: 2 steps/second");
  Serial.println("⚠️  WATCH THE MOTOR SHAFT!");
  Serial.println();

  digitalWrite(DIR_PIN, LOW);
  delay(100);

  for (int i = 0; i < 50; i++) {
    digitalWrite(STEP_PIN, HIGH);
    delayMicroseconds(10);
    digitalWrite(STEP_PIN, LOW);
    delay(500);  // 500ms = 2 steps/second (VERY SLOW!)

    if (i % 10 == 0) {
      Serial.print("  Step: "); Serial.println(i);
    }
  }
  Serial.println("✓ Backward test complete");
  Serial.println();

  // Disable motor
  digitalWrite(EN_PIN, HIGH);

  // Results
  Serial.println("╔════════════════════════════════════════════╗");
  Serial.println("║            TEST RESULTS                    ║");
  Serial.println("╚════════════════════════════════════════════╝");
  Serial.println();
  Serial.println("Did motor rotate?");
  Serial.println();
  Serial.println("✓ YES → Hardware working! Problem was AccelStepper");
  Serial.println();
  Serial.println("✗ NO → Hardware issue. Check:");
  Serial.println("   1. TMC2209 Vref too low → Turn potentiometer CLOCKWISE");
  Serial.println("   2. 12V power supply to VM pin");
  Serial.println("   3. Motor coil wiring (try swapping A1<->A2)");
  Serial.println("   4. STEP/DIR/EN pin connections");
  Serial.println("   5. Motor mechanically stuck?");
  Serial.println();
  Serial.println("═══════════════════════════════════════════");

  server.send(200, "text/plain", "Diagnostic test complete - check Serial Monitor");
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
  delay(1000);  // Wait for serial and power to stabilize

  Serial.println("\n\n=== ESP32 Starting ===");

  // CRITICAL: Setup and DISABLE stepper driver FIRST to prevent brown-out
  pinMode(EN_PIN, OUTPUT);
  pinMode(STEP_PIN, OUTPUT);
  pinMode(DIR_PIN, OUTPUT);
  pinMode(MS1_PIN, OUTPUT);
  pinMode(MS2_PIN, OUTPUT);

  digitalWrite(EN_PIN, HIGH);   // HIGH = DISABLED (CRITICAL!)
  digitalWrite(STEP_PIN, LOW);
  digitalWrite(DIR_PIN, LOW);
  digitalWrite(MS1_PIN, LOW);
  digitalWrite(MS2_PIN, LOW);

  Serial.println("Stepper driver DISABLED - power safe");
  delay(500);  // Let power stabilize

  // Initialize EEPROM (ESP32 needs explicit size)
  EEPROM.begin(512);

  // Initialize DHT sensor
  dht.begin();

  // Setup relay pins (relays are active LOW)
  pinMode(RELAY_FAN, OUTPUT);
  pinMode(RELAY_PUMP1, OUTPUT);
  pinMode(RELAY_PUMP2, OUTPUT);
  pinMode(RELAY_LED, OUTPUT);

  digitalWrite(RELAY_FAN, HIGH);     // HIGH = OFF
  digitalWrite(RELAY_PUMP1, HIGH);   // HIGH = OFF
  digitalWrite(RELAY_PUMP2, HIGH);   // HIGH = OFF
  digitalWrite(RELAY_LED, HIGH);     // HIGH = OFF

  // Setup ultrasonic sensor pins
  pinMode(TRIG, OUTPUT);
  pinMode(ECHO, INPUT);

  // Set to FULL STEP mode for maximum torque
  setMicrostepping(1);

  // Initialize stepper parameters
  stepsPerMM = (motorStepsPerRev * microsteps) / leadScrewPitch;
  Serial.print("Steps per mm = ");
  Serial.println(stepsPerMM);

  // SLOW speed for maximum torque - very conservative settings
  stepper.setMaxSpeed(200);        // Very slow for debugging
  stepper.setAcceleration(100);    // Gentle acceleration

  Serial.println("Motor configured for FULL STEP mode (maximum torque)");

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
    Serial.println("Previous state restored - ready to continue");
  }

  // Connect to WiFi
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  connectToWiFi();

  // Setup web server routes
  server.on("/api/status", HTTP_GET, handleStatus);
  server.on("/api/status", HTTP_OPTIONS, handleCORS);
  server.on("/api/control", HTTP_GET, handleControl);
  server.on("/api/control", HTTP_OPTIONS, handleCORS);
  server.on("/api/test", HTTP_GET, handleTest);  // Hardware test endpoint
  server.begin();

  Serial.println("HTTP server started");
  Serial.println("Motor starts DISABLED - use dashboard to enable");
  Serial.println("");
  Serial.println("=== DIAGNOSTICS ===");
  Serial.print("EN_PIN (GPIO"); Serial.print(EN_PIN); Serial.print("): ");
  Serial.println(digitalRead(EN_PIN) == LOW ? "ENABLED" : "DISABLED");
  Serial.print("MS1_PIN (GPIO"); Serial.print(MS1_PIN); Serial.print("): ");
  Serial.println(digitalRead(MS1_PIN) == LOW ? "LOW" : "HIGH");
  Serial.print("MS2_PIN (GPIO"); Serial.print(MS2_PIN); Serial.print("): ");
  Serial.println(digitalRead(MS2_PIN) == LOW ? "LOW" : "HIGH");
  Serial.println("");
  Serial.println("Ready!");
  Serial.println("To test motor: http://" + WiFi.localIP().toString() + "/api/test");
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

  // Read sensors periodically (less frequent to keep loop fast for stepper)
  static unsigned long lastSensorRead = 0;
  if (millis() - lastSensorRead > 5000) {  // Every 5 seconds instead of 2
    readSensors();
    lastSensorRead = millis();

    // Only print if stepper is not running to reduce serial overhead
    if (!stepperEnabled || !stepper.isRunning()) {
      Serial.print("Sensors - Temp: ");
      Serial.print(temperature);
      Serial.print("C, Hum: ");
      Serial.print(humidity);
      Serial.print("%, PH: ");
      Serial.print(phValue);
      Serial.print(", Dist: ");
      Serial.print(distance);
      Serial.println("cm");
    }
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

  // Run stepper if enabled - CRITICAL: Must call run() frequently!
  if (stepperEnabled) {
    bool didMove = stepper.run();

    // REAL-TIME debugging - show IMMEDIATELY when step happens
    static long lastPosition = 0;
    static unsigned long stepCount = 0;

    long currentPos = stepper.currentPosition();
    if (currentPos != lastPosition) {
      stepCount++;
      if (stepCount % 10 == 0) {  // Print every 10 steps
        Serial.print("MOVING! Steps: ");
        Serial.print(stepCount);
        Serial.print(" | Pos: ");
        Serial.println(currentPos);
      }
      lastPosition = currentPos;
    }

    // Debug every second
    static unsigned long lastDebug = 0;
    if (millis() - lastDebug > 1000) {
      long targetPos = stepper.targetPosition();
      long distanceToGo = stepper.distanceToGo();
      float currentSpeed = stepper.speed();

      Serial.println("=== STEPPER DEBUG ===");
      Serial.print("Enabled: YES | Running: ");
      Serial.println(stepper.isRunning() ? "YES" : "NO");
      Serial.print("Current Pos: ");
      Serial.print(currentPos);
      Serial.print(" | Target: ");
      Serial.println(targetPos);
      Serial.print("Distance to go: ");
      Serial.print(distanceToGo);
      Serial.print(" | Speed: ");
      Serial.println(currentSpeed);
      Serial.print("Max Speed: ");
      Serial.print(stepper.maxSpeed());
      Serial.print(" | Acceleration: ");
      Serial.println(stepper.acceleration());
      Serial.print("Steps per mm: ");
      Serial.println(stepsPerMM);

      if (distanceToGo == 0) {
        Serial.println("⚠️ Distance = 0 → Click LEFT/RIGHT button!");
      }

      if (currentSpeed == 0 && distanceToGo != 0) {
        Serial.println("⚠️ Speed = 0 but distance > 0 → PROBLEM!");
        Serial.println("Trying to force movement...");
        // Force a new target
        stepper.moveTo(stepper.currentPosition() + 100);
      }

      Serial.println("====================");
      lastDebug = millis();
    }
  } else {
    // Debug when disabled
    static unsigned long lastDisabledDebug = 0;
    if (millis() - lastDisabledDebug > 5000) {
      Serial.println("⏸️ Stepper DISABLED - Enable from dashboard");
      lastDisabledDebug = millis();
    }
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

  // NO DELAY - stepper.run() must be called as fast as possible!
  // Even delay(1) can cause missed steps
}