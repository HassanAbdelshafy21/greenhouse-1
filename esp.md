/*
  * ========================================
  * GREENHOUSE CONTROL SYSTEM - ESP32
  * ========================================
  * Smart greenhouse automation with web interface
  * Controls: Fan, Pumps, LED
  * Sensors: Temperature, Humidity, pH, Distance, Air Quality
  *
  * Author: Greenhouse Team
  * Hardware: ESP32 + DHT22 + Relays
  * ========================================
  */

  #include <WiFi.h>
  #include <WebServer.h>
  #include <DHT.h>
 
  // ========================================
  // WIFI CONFIGURATION
  // ========================================
  const char* ssid = "SmartHomeX11";
  const char* password = "x11smart123";

  // ========================================
  // GPIO PIN DEFINITIONS
  // ========================================

  // Relay pins (Active LOW - LOW = ON, HIGH = OFF)
  #define RELAY_FAN   5      // Fan control relay
  #define RELAY_PUMP1 4      // Water pump 1 relay
  #define RELAY_PUMP2 14     // Water pump 2 relay
  #define RELAY_LED   12     // LED grow lights relay

  // Sensor pins
  #define DHTPIN      2      // DHT22 temperature & humidity sensor
  #define DHTTYPE     DHT22  // DHT sensor type
  #define PHSENSORPIN 34     // Analog pH sensor (ADC pin)
  #define TRIG        0      // Ultrasonic sensor trigger pin
  #define ECHO        13     // Ultrasonic sensor echo pin

  // Stepper motor pins
  #define EN_PIN      27     // Enable pin
  #define DIR_PIN     26     // Direction pin
  #define STEP_PIN    25     // Step pulse pin

  // ========================================
  // OBJECT INSTANCES
  // ========================================
  WebServer server(80);                                           // Web server on port 80
  DHT dht(DHTPIN, DHTTYPE);                                      // DHT sensor object
 
  // ========================================
  // DEVICE STATE VARIABLES
  // ========================================
  bool fanState = false;      // Fan state (false = OFF, true = ON)
  bool pump1State = false;    // Pump 1 state
  bool pump2State = false;    // Pump 2 state
  bool ledState = false;      // LED state

  // ========================================
  // SENSOR DATA VARIABLES
  // ========================================
  float temperature = 0.0;    // Temperature in Celsius
  float humidity = 0.0;       // Humidity percentage
  float distance = 0.0;       // Water level distance in cm
  int phValue = 0;            // pH sensor raw ADC value (0-4095)

  // ========================================
  // STEPPER MOTOR CONFIGURATION
  // ========================================
  const float steps_per_mm = 40000.0 / 100.0;  // 40000 steps for 100 mm = 400 steps/mm
  const float travel_distance_mm = 100.0;       // 100 mm travel distance
  const int speedDelay = 250;                   // Delay in microseconds (smaller = faster)
  bool stepperEnabled = false;                  // Stepper enable state

  // ========================================
  // TIMING CONSTANTS
  // ========================================
  const unsigned long WIFI_CHECK_INTERVAL = 30000;  // Check WiFi every 30 seconds
  const unsigned long SENSOR_READ_INTERVAL = 5000;  // Read sensors every 5 seconds

  // WiFi reconnection timer
  unsigned long lastWiFiCheck = 0;

  // ========================================
  // FUNCTION: MOVE STEPPER BY DISTANCE
  // ========================================
  /*
  * Moves stepper motor by specified distance in mm
  * Uses direct pin control (no library required)
  */
  void moveDistance(float distance_mm, bool reverse) {
    long steps = distance_mm * steps_per_mm;
    digitalWrite(DIR_PIN, reverse ? HIGH : LOW);

    for (long i = 0; i < steps; i++) {
      digitalWrite(STEP_PIN, HIGH);
      delayMicroseconds(speedDelay);
      digitalWrite(STEP_PIN, LOW);
      delayMicroseconds(speedDelay);
    }
  }

  // ========================================
  // FUNCTION: READ ALL SENSORS
  // ========================================
  /*
  * Reads all sensor values:
  * - DHT22: Temperature and humidity
  * - pH sensor: Analog value
  * - Ultrasonic: Water level distance
  */
  void readSensors() {
    // Read DHT22 sensor
    float h = dht.readHumidity();
    float t = dht.readTemperature();

    // Update only if valid readings
    if (!isnan(h)) humidity = h;
    if (!isnan(t)) temperature = t;

    // Read pH sensor (analog value 0-4095)
    phValue = analogRead(PHSENSORPIN);

    // Read ultrasonic distance sensor
    digitalWrite(TRIG, LOW);
    delayMicroseconds(2);
    digitalWrite(TRIG, HIGH);
    delayMicroseconds(10);
    digitalWrite(TRIG, LOW);

    // Calculate distance in cm (speed of sound = 343 m/s = 0.034 cm/μs)
    long duration = pulseIn(ECHO, HIGH, 30000); // 30ms timeout
    float dist = duration * 0.034 / 2;

    // Update only if valid reading (0-400 cm range)
    if (!isnan(dist) && dist >= 0 && dist <= 400) {
      distance = dist;
    }
  }

  // ========================================
  // API ENDPOINT: GET STATUS
  // ========================================
  /*
  * Returns JSON with all system status:
  * - Sensor readings (temperature, humidity, pH, distance)
  * - Device states (fan, pumps, LED)
  *
  * Endpoint: GET /api/status
  * Response: application/json
  */
  void handleStatus() {
    // Enable CORS for web frontend
    server.sendHeader("Access-Control-Allow-Origin", "*");

    // Build JSON response
    String json = "{";
    json += "\"temperature\":" + String(temperature, 1);
    json += ",\"humidity\":" + String(humidity, 1);
    json += ",\"ph\":" + String(phValue);
    json += ",\"distance\":" + String(distance, 1);

    // Device states (as strings for frontend compatibility)
    json += ",\"fan\":\"" + String(fanState ? "1" : "0") + "\"";
    json += ",\"pump1\":\"" + String(pump1State ? "1" : "0") + "\"";
    json += ",\"pump2\":\"" + String(pump2State ? "1" : "0") + "\"";
    json += ",\"led\":\"" + String(ledState ? "1" : "0") + "\"";
    json += ",\"stepper_enabled\":\"" + String(stepperEnabled ? "1" : "0") + "\"";
    json += "}";

    server.send(200, "application/json", json);
  }

  // ========================================
  // API ENDPOINT: CONTROL DEVICES
  // ========================================
  /*
  * Controls all devices via query parameters
  *
  * Endpoint: GET /api/control
  *
  * Parameters:
  * - fan=0/1              : Turn fan OFF/ON
  * - pump1=0/1            : Turn pump 1 OFF/ON
  * - pump2=0/1            : Turn pump 2 OFF/ON
  * - led=0/1              : Turn LED OFF/ON
  * - stepper_enable=0/1   : Disable/Enable stepper motor
  * - stepper_move=distance : Move stepper forward by distance (mm)
  * - stepper_move_back=distance : Move stepper backward by distance (mm)
  *
  * Note: Relays are active LOW (0=ON in software, but LOW=ON in hardware)
  */
  void handleControl() {
    // Enable CORS for web frontend
    server.sendHeader("Access-Control-Allow-Origin", "*");

    // ===== RELAY CONTROLS =====
    // Frontend sends: "0" = OFF, "1" = ON
    // Hardware needs: HIGH = OFF, LOW = ON (inverted logic)

    if (server.hasArg("fan")) {
      fanState = server.arg("fan") == "1";
      digitalWrite(RELAY_FAN, fanState ? LOW : HIGH);
      Serial.print("Fan: "); Serial.println(fanState ? "ON" : "OFF");
    }

    if (server.hasArg("pump1")) {
      pump1State = server.arg("pump1") == "1";
      digitalWrite(RELAY_PUMP1, pump1State ? LOW : HIGH);
      Serial.print("Pump 1: "); Serial.println(pump1State ? "ON" : "OFF");
    }

    if (server.hasArg("pump2")) {
      pump2State = server.arg("pump2") == "1";
      digitalWrite(RELAY_PUMP2, pump2State ? LOW : HIGH);
      Serial.print("Pump 2: "); Serial.println(pump2State ? "ON" : "OFF");
    }

    if (server.hasArg("led")) {
      ledState = server.arg("led") == "1";
      digitalWrite(RELAY_LED, ledState ? LOW : HIGH);
      Serial.print("LED: "); Serial.println(ledState ? "ON" : "OFF");
    }

    // ===== STEPPER ENABLE/DISABLE =====
    if (server.hasArg("stepper_enable")) {
      stepperEnabled = server.arg("stepper_enable") == "1";
      digitalWrite(EN_PIN, stepperEnabled ? LOW : HIGH);
      Serial.print("Stepper: ");
      Serial.println(stepperEnabled ? "ENABLED" : "DISABLED");
      server.send(200, "text/plain", stepperEnabled ? "Stepper ENABLED" : "Stepper DISABLED");
      return;
    }

    // ===== STEPPER MOVE FORWARD =====
    if (server.hasArg("stepper_move")) {
      if (!stepperEnabled) {
        server.send(400, "text/plain", "ERROR: Stepper disabled. Enable it first!");
        return;
      }
      float distance = server.arg("stepper_move").toFloat();
      Serial.print("Moving forward: ");
      Serial.print(distance);
      Serial.println(" mm");
      moveDistance(distance, false);
      server.send(200, "text/plain", "Moved forward " + String(distance) + " mm");
      return;
    }

    // ===== STEPPER MOVE BACKWARD =====
    if (server.hasArg("stepper_move_back")) {
      if (!stepperEnabled) {
        server.send(400, "text/plain", "ERROR: Stepper disabled. Enable it first!");
        return;
      }
      float distance = server.arg("stepper_move_back").toFloat();
      Serial.print("Moving backward: ");
      Serial.print(distance);
      Serial.println(" mm");
      moveDistance(distance, true);
      server.send(200, "text/plain", "Moved backward " + String(distance) + " mm");
      return;
    }

    // Default response for successful commands
    server.send(200, "text/plain", "OK");
  }

  // ========================================
  // FUNCTION: CONNECT TO WIFI
  // ========================================
  /*
  * Attempts to connect to WiFi network
  * Tries for 10 seconds (20 attempts × 500ms)
  */
  void connectToWiFi() {
    Serial.print("Connecting to WiFi: ");
    Serial.println(ssid);

    WiFi.begin(ssid, password);
    int attempts = 0;

    while (WiFi.status() != WL_CONNECTED && attempts < 20) {
      delay(500);
      Serial.print(".");
      attempts++;
    }

    Serial.println();

    if (WiFi.status() == WL_CONNECTED) {
      Serial.println("✓ WiFi connected successfully!");
      Serial.print("IP Address: ");
      Serial.println(WiFi.localIP());
    } else {
      Serial.println("✗ Failed to connect to WiFi");
      Serial.println("Will retry in 30 seconds...");
    }
  }

  // ========================================
  // SETUP FUNCTION
  // ========================================
  void setup() {
    // Initialize serial communication
    Serial.begin(115200);
    delay(500);
    Serial.println("\n\n");
    Serial.println("========================================");
    Serial.println("  GREENHOUSE CONTROL SYSTEM - ESP32");
    Serial.println("========================================");

    // ===== CONFIGURE RELAY PINS =====
    Serial.println("Initializing relay outputs...");
    pinMode(RELAY_FAN, OUTPUT);
    pinMode(RELAY_PUMP1, OUTPUT);
    pinMode(RELAY_PUMP2, OUTPUT);
    pinMode(RELAY_LED, OUTPUT);

    // Set all relays to OFF (HIGH = OFF for active-low relays)
    digitalWrite(RELAY_FAN, HIGH);
    digitalWrite(RELAY_PUMP1, HIGH);
    digitalWrite(RELAY_PUMP2, HIGH);
    digitalWrite(RELAY_LED, HIGH);
    Serial.println("✓ All relays initialized (OFF)");

    // ===== CONFIGURE STEPPER MOTOR =====
    Serial.println("Initializing stepper motor...");
    pinMode(EN_PIN, OUTPUT);
    pinMode(DIR_PIN, OUTPUT);
    pinMode(STEP_PIN, OUTPUT);
    digitalWrite(EN_PIN, HIGH);  // Disabled by default
    Serial.println("✓ Stepper motor initialized (DISABLED)");

    // ===== INITIALIZE SENSORS =====
    Serial.println("Initializing sensors...");
    dht.begin();
    pinMode(TRIG, OUTPUT);
    pinMode(ECHO, INPUT);
    Serial.println("✓ DHT22 and ultrasonic sensors ready");

    // ===== CONNECT TO WIFI =====
    Serial.println("Connecting to WiFi...");
    WiFi.mode(WIFI_STA);
    WiFi.setAutoReconnect(true);
    connectToWiFi();

    // ===== START WEB SERVER =====
    Serial.println("Starting web server...");
    server.on("/api/status", HTTP_GET, handleStatus);
    server.on("/api/control", HTTP_GET, handleControl);
    server.begin();
    Serial.println("✓ Web server started on port 80");

    // ===== DISPLAY SYSTEM INFO =====
    Serial.println("\n========================================");
    Serial.println("       SYSTEM READY");
    Serial.println("========================================");
    Serial.print("WiFi Status: ");
    Serial.println(WiFi.status() == WL_CONNECTED ? "Connected" : "Disconnected");
    Serial.print("IP Address: ");
    Serial.println(WiFi.localIP());
    Serial.println();
    Serial.println("Stepper Configuration:");
    Serial.print("  Steps per mm: ");
    Serial.println(steps_per_mm);
    Serial.print("  Travel distance: ");
    Serial.print(travel_distance_mm);
    Serial.println(" mm");
    Serial.print("  Speed delay: ");
    Serial.print(speedDelay);
    Serial.println(" μs");
    Serial.println();
    Serial.println("API Endpoints:");
    Serial.println("  GET /api/status          - Get system status");
    Serial.println("  GET /api/control?...     - Control devices");
    Serial.println("========================================\n");
  }

  // ========================================
  // MAIN LOOP
  // ========================================
  void loop() {
    // Handle incoming HTTP requests
    server.handleClient();

    // ===== WIFI RECONNECTION CHECK =====
    // Check WiFi connection every 30 seconds
    unsigned long currentTime = millis();
    if (currentTime - lastWiFiCheck >= WIFI_CHECK_INTERVAL) {
      lastWiFiCheck = currentTime;
      if (WiFi.status() != WL_CONNECTED) {
        Serial.println("WiFi disconnected! Attempting reconnection...");
        connectToWiFi();
      }
    }

    // ===== READ SENSORS =====
    // Read all sensors every 5 seconds
    static unsigned long lastSensorRead = 0;
    if (millis() - lastSensorRead >= SENSOR_READ_INTERVAL) {
      readSensors();
      lastSensorRead = millis();

      // Optional: Print sensor readings (comment out to reduce serial spam)
      // Serial.print("Temp: "); Serial.print(temperature); Serial.print("°C  ");
      // Serial.print("Humidity: "); Serial.print(humidity); Serial.print("%  ");
      // Serial.print("Distance: "); Serial.print(distance); Serial.println("cm");
    }
  }