import cv2
import os
import time
from datetime import datetime

# Replace with your Raspberry Pi stream URL
stream_url = "http://192.168.137.50:5000/video_feed"

# Open stream
cap = cv2.VideoCapture(stream_url)

if not cap.isOpened():
    print("Error: Could not open video stream.")
    exit()

# Create folder to save images
save_dir = "captured_images"
os.makedirs(save_dir, exist_ok=True)

print("Capturing images every 20 seconds... Press Ctrl+C to stop.")

try:
    while True:
        ret, frame = cap.read()
        if not ret:
            print("Failed to grab frame.")
            break

        # Save frame
        filename = datetime.now().strftime("%Y%m%d_%H%M%S") + ".jpg"
        filepath = os.path.join(save_dir, filename)
        cv2.imwrite(filepath, frame)
        print(f"Saved: {filepath}")

        # Wait 20 seconds before next capture
        time.sleep(60)

except KeyboardInterrupt:
    print("\nStopped by user.")

cap.release()
cv2.destroyAllWindows()