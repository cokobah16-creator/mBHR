# Med Bridge Health Reach (M.B.H.R.)

Med Bridge Health Reach (M.B.H.R.) is an offline-first Progressive Web Application (PWA) designed for medical outreach in Nigeria. The application aims to facilitate patient registration, vital screening, consultation notes, and pharmacy dispensing, all while ensuring functionality without an internet connection.

## Features

- **Offline-First Design**: The application operates fully offline, allowing healthcare providers to register patients, record vitals, take consultation notes, and manage pharmacy dispensing without requiring internet access.
- **User Authentication**: Supports local authentication with device-bound Admin Setup PIN and per-user offline PINs, ensuring secure access to the application.
- **Patient Management**: Easily register patients with minimal fields and photo upload, link family members, and manage patient data efficiently.
- **Vitals Screening**: Capture vital signs with automatic flagging for abnormal readings, including BMI calculations.
- **Consultation Notes**: Enter SOAP notes and provisional diagnoses for each patient visit.
- **Pharmacy Management**: Log dispensed medications and manage inventory with simple stock counts.
- **Internationalization**: Supports multiple languages, including English, Hausa, Yoruba, Igbo, and Pidgin.

## Getting Started

### Prerequisites

- Node.js (version 14 or higher)
- pnpm (package manager)

### Installation

1. Clone the repository:
   ```
   git clone <repository-url>
   cd mBHR
   ```

2. Install dependencies:
   ```
   pnpm install
   ```

3. Run the application:
   ```
   pnpm dev
   ```

### Usage

- Start the application and access it via your web browser.
- Use the "Skip Login" option to access the dashboard in offline mode.
- Register patients, enter vitals, take consultation notes, and manage pharmacy dispensing.

## Testing

To run acceptance tests manually, follow these steps:

1. Start the app fresh and click "Skip Login" to land on the Dashboard with the "Offline" badge.
2. Register a patient with a photo and start a visit; the patient should appear in the Registration → Vitals queue.
3. Enter vitals and verify that BMI auto-calculates and abnormal flags appear.
4. Add SOAP consultation notes and provisional diagnoses, then save offline.
5. Dispense medications and check that inventory decrements correctly.
6. Kill the internet connection, refresh the app, and ensure all data is still present.
7. Export patient data in CSV format and verify the correctness of the downloaded file.

## Contributing

Contributions are welcome! Please open an issue or submit a pull request for any enhancements or bug fixes.

## License

This project is licensed under the MIT License. See the LICENSE file for details.