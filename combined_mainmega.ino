#include <DHT.h>
#include <AccelStepper.h>
#include <EEPROM.h>

// Sensor Pins
#define DHTPIN 2
#define DHTTYPE DHT22
#define MQ135PIN A2
#define PHSENSORPIN A0
#define TRIG 3
#define ECHO 4

// Stepper Motor Pins
#define STEP_PIN 10
#define DIR_PIN  11
#define EN_PIN   12

DHT dht(DHTPIN, DHTTYPE);
AccelStepper stepper(AccelStepper::DRIVER, STEP_PIN, DIR_PIN);

// Motor parameters
const int motorStepsPerRev = 200;
const int microsteps = 16;
const float leadScrewPitch = 8.0; // TR8x8 = 8mm/rev

// Soft limits (mm) - 10cm in each direction from center
const float MIN_MM = -100.0; // 10 cm left
const float MAX_MM = 100.0;  // 10 cm right

float stepsPerMM;
long targetSteps;
bool goingForward = false; // Start moving left first

// EEPROM addresses
const int EEPROM_ADDR = 0;
const int EEPROM_MAGIC_ADDR = 4;
const int EEPROM_DIRECTION_ADDR = 8;
const int EEPROM_TARGET_ADDR = 12;
const long EEPROM_MAGIC_NUMBER = 0x12345678; // Magic number to verify valid data

void saveStateToEEPROM(long currentPos, long targetPos, bool direction) {
  EEPROM.put(EEPROM_ADDR, currentPos);
  EEPROM.put(EEPROM_TARGET_ADDR, targetPos);
  EEPROM.put(EEPROM_DIRECTION_ADDR, direction);
  EEPROM.put(EEPROM_MAGIC_ADDR, EEPROM_MAGIC_NUMBER); // Mark as valid
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
    *targetPos = MIN_MM * stepsPerMM; // First target is LEFT
    *direction = false; // Start going left
    saveStateToEEPROM(*currentPos, *targetPos, *direction);
    return false; // New start
  }

  EEPROM.get(EEPROM_ADDR, *currentPos);
  EEPROM.get(EEPROM_TARGET_ADDR, *targetPos);
  EEPROM.get(EEPROM_DIRECTION_ADDR, *direction);

  // Validate position is within reasonable limits
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

  return true; // Successfully restored
}

// Calculate estimated move time based on acceleration profile
float calculateMoveTime(long steps) {
  float maxSpeed = 3000.0;      // steps/sec
  float acceleration = 2000.0;  // steps/sec^2

  float timeToMaxSpeed = maxSpeed / acceleration;
  float stepsToMaxSpeed = 0.5 * acceleration * timeToMaxSpeed * timeToMaxSpeed;

  if (steps <= 2 * stepsToMaxSpeed) {
    // Triangle profile (never reaches max speed)
    float peakSpeed = sqrt(steps * acceleration);
    return 2 * (peakSpeed / acceleration);
  } else {
    // Trapezoidal profile
    float constantSpeedSteps = steps - (2 * stepsToMaxSpeed);
    float constantSpeedTime = constantSpeedSteps / maxSpeed;
    return (2 * timeToMaxSpeed) + constantSpeedTime;
  }
}

void setup() {
  Serial.begin(9600);   // For debugging via USB
  Serial1.begin(9600);  // For communication with ESP32
  dht.begin();

  // Ultrasonic sensor pins
  pinMode(TRIG, OUTPUT);
  pinMode(ECHO, INPUT);

  Serial.println("=== STEPPER MOTOR DEBUG START ===");

  // Pin setup with debug
  pinMode(EN_PIN, OUTPUT);
  pinMode(STEP_PIN, OUTPUT);
  pinMode(DIR_PIN, OUTPUT);

  Serial.println("Pins configured");

  // Enable driver
  digitalWrite(EN_PIN, LOW); // Enable driver
  digitalWrite(STEP_PIN, LOW);
  digitalWrite(DIR_PIN, LOW);

  Serial.println("Driver enabled (EN_PIN = LOW)");
  Serial.print("STEP_PIN: "); Serial.println(STEP_PIN);
  Serial.print("DIR_PIN: "); Serial.println(DIR_PIN);
  Serial.print("EN_PIN: "); Serial.println(EN_PIN);

  Serial.println("Stepper resume demo (10cm LEFT + 10cm RIGHT = 20cm total) - Starting LEFT");

  stepsPerMM = (motorStepsPerRev * microsteps) / leadScrewPitch;
  Serial.print("Steps per mm = ");
  Serial.println(stepsPerMM);

  stepper.setMaxSpeed(3000);    // steps/sec (increased speed)
  stepper.setAcceleration(2000); // steps/sec^2 (faster acceleration)

  // Retrieve complete state from EEPROM
  Serial.println("Reading state from EEPROM...");
  long currentPos, savedTarget;
  bool savedDirection;
  bool wasRestored = readStateFromEEPROM(&currentPos, &savedTarget, &savedDirection);

  stepper.setCurrentPosition(currentPos);
  targetSteps = savedTarget;
  goingForward = savedDirection;

  Serial.print("Motor position set to: ");
  Serial.print((float)currentPos / stepsPerMM);
  Serial.print("mm (");
  Serial.print(currentPos);
  Serial.println(" steps)");

  if (wasRestored) {
    Serial.println("CONTINUING previous movement to target:");
    Serial.print("Target: ");
    Serial.print((float)targetSteps / stepsPerMM);
    Serial.print("mm, Direction: ");
    Serial.println(goingForward ? "RIGHT (next)" : "LEFT (next)");

    // Resume movement to the saved target
    stepper.moveTo(targetSteps);
  }

  // Show movement limits
  Serial.print("Movement range: ");
  Serial.print(MIN_MM);
  Serial.print("mm to ");
  Serial.print(MAX_MM);
  Serial.println("mm");

  // Quick manual test
  Serial.println("Testing manual movement - 10 steps...");
  digitalWrite(DIR_PIN, HIGH);
  for(int i = 0; i < 10; i++) {
    digitalWrite(STEP_PIN, HIGH);
    delay(100);
    digitalWrite(STEP_PIN, LOW);
    delay(100);
    Serial.print("Step: "); Serial.println(i+1);
  }
  Serial.println("Manual test complete. Did motor move?");

  Serial.println("Ready to start AccelStepper movement cycle...");
  delay(2000);
}

void loop() {
  // DHT22
  float h = dht.readHumidity();
  float t = dht.readTemperature();

  // MQ135
  int mq = analogRead(MQ135PIN);

  // PH Sensor
  int ph = analogRead(PHSENSORPIN);

  // Ultrasonic
  digitalWrite(TRIG, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIG, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG, LOW);
  long duration = pulseIn(ECHO, HIGH);
  float distance = duration * 0.034 / 2;

  // Send to ESP32 via Serial1
  Serial1.print("{\"temp\":");
  Serial1.print(t);
  Serial1.print(",\"hum\":");
  Serial1.print(h);
  Serial1.print(",\"mq\":");
  Serial1.print(mq);
  Serial1.print(",\"ph\":");
  Serial1.print(ph);
  Serial1.print(",\"dist\":");
  Serial1.print(distance);
  Serial1.println("}");

  // Debug output to USB Serial
  Serial.print("Sent to ESP32: ");
  Serial.print("{\"temp\":");
  Serial.print(t);
  Serial.print(",\"hum\":");
  Serial.print(h);
  Serial.print(",\"mq\":");
  Serial.print(mq);
  Serial.print(",\"ph\":");
  Serial.print(ph);
  Serial.print(",\"dist\":");
  Serial.print(distance);
  Serial.println("}");

  // Stepper motor control
  if (!stepper.isRunning()) {
    // Debug: Show what's happening
    Serial.println("--- Setting new target ---");
    Serial.print("goingForward: "); Serial.println(goingForward);

    if (goingForward) {
      targetSteps = MAX_MM * stepsPerMM;
      Serial.print("Moving RIGHT to: "); Serial.print(MAX_MM); Serial.println("mm");
    } else {
      targetSteps = MIN_MM * stepsPerMM;
      Serial.print("Moving LEFT to: "); Serial.print(MIN_MM); Serial.println("mm");
    }

    Serial.print("Target steps: "); Serial.println(targetSteps);
    Serial.print("Current position: "); Serial.println(stepper.currentPosition());

    stepper.moveTo(targetSteps);
    goingForward = !goingForward; // Switch direction for next time

    Serial.println("Movement started...");

    // Calculate estimated time
    long distance = abs(targetSteps - stepper.currentPosition());
    float distanceMM = (float)distance / stepsPerMM;
    float estimatedTime = calculateMoveTime(distance);
    Serial.print("Distance: ");
    Serial.print(distanceMM);
    Serial.print("mm, Est. time: ");
    Serial.print(estimatedTime);
    Serial.println("s");
  }

  stepper.run();

  // Debug: Show progress every 1 second with speed info
  static unsigned long lastDebug = 0;
  if (millis() - lastDebug > 1000) {
    if (stepper.isRunning()) {
      Serial.print("Pos: ");
      Serial.print((float)stepper.currentPosition() / stepsPerMM);
      Serial.print("mm → Target: ");
      Serial.print((float)targetSteps / stepsPerMM);
      Serial.print("mm, Speed: ");
      Serial.print(stepper.speed());
      Serial.print(" steps/s (");
      Serial.print(stepper.speed() / stepsPerMM);
      Serial.print(" mm/s), Remaining: ");
      Serial.print(abs(targetSteps - stepper.currentPosition()));
      Serial.println(" steps");
    }
    lastDebug = millis();
  }

  // Save complete state periodically (every 2 seconds to reduce EEPROM wear)
  static unsigned long lastSave = 0;
  static long lastSavedPosition = 0;

  if (millis() - lastSave > 2000) {
    long currentPos = stepper.currentPosition();
    // Only save if position changed significantly (>10 steps = 0.025mm)
    if (abs(currentPos - lastSavedPosition) > 10) {
      saveStateToEEPROM(currentPos, targetSteps, goingForward);
      lastSavedPosition = currentPos;
    }
    lastSave = millis();
  }

  delay(2000);
}