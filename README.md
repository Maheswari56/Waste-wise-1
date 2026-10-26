# WasteWise — Smart Waste Reporting System
### HackOctober 2026 Hackathon Project

> **"Report Waste. Protect Our Planet."**

WasteWise is a civic technology web application built to empower citizens to report garbage accumulation, illegal dumping, and hazardous waste. It features real-time complaint tracking with municipal lifecycle management (Pending &rarr; In Progress &rarr; Resolved), persistent SQLite storage, and an **AI Waste Assistant** that categorizes waste and provides eco-disposal guidance with an automatic offline fallback.

---

## 🌟 Key Features

1. **Impact Dashboard**
   - Live metrics showing **Total Reports**, **Pending**, **In Progress**, and **Resolved** waste complaints.
2. **Citizen Waste Reporting Form**
   - Reporter Name (optional or anonymous).
   - Category selection (*Plastic, Food Waste, Electronic Waste, Medical Waste, General Waste*).
   - Severity level (*Low, Medium, High*).
   - Location input with one-click **GPS Auto-Detect & Reverse Geocoding** button (converts coordinates to a human-readable address with automatic GPS fallback).
   - Secure photographic evidence upload with drag-and-drop & instant thumbnail preview.
3. **Complaint Management & Live Action Tracker**
   - Parameterized SQLite search by location, report ID, or description.
   - Filter by Category and Status.
   - Expandable details modal with full photographic inspection.
   - **Demonstration Administrator Mode** protected with passcode (`admin123`) to update complaint statuses.
4. **AI Waste Assistant**
   - Intelligent categorization and instant disposal steps.
   - Environmental and health hazards breakdown in clear language.
   - Integrates with Google Gemini API when configured, with a built-in **Rule-Based Fallback Engine** that works immediately without any API keys.
5. **Hackathon Design & Security**
   - Fresh green and clean white environmental theme.
   - Fully responsive for mobile and desktop screens.
   - SQL injection prevention via parameterized queries.
   - Safe file-handling (UUIDs, restricted file types, 8MB max size).
   - Zero secrets exposed to client scripts; configuration via `.env`.

---

## 📁 Project Structure

```text
WasteWise/
│
├── app.py                  # Flask backend server, DB models, & API routes
├── requirements.txt        # Python library dependencies
├── .env.example            # Template for environment variables
├── .env                    # Active local environment settings (gitignored)
├── .gitignore              # Git ignore rules for sensitive files
├── README.md               # Beginner-friendly documentation
├── database.db             # SQLite database (auto-generated)
│
├── uploads/                # Directory for safe photo uploads
│   └── .gitkeep
│
├── templates/
│   └── index.html          # Main application interface
│
└── static/
    ├── style.css           # Modern green & clean theme stylesheet
    └── script.js           # Client-side reactivity, search, and API calls
```

---

## 🚀 Beginner-Friendly Setup Instructions (Windows)

Follow these simple steps in **PowerShell** or **Command Prompt**:

### Step 1: Open the Project Directory
```powershell
cd "c:\Users\nellu\Downloads\Waste wise"
```

### Step 2: (Recommended) Create & Activate a Virtual Environment
```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
```
*(If PowerShell restricts scripts, run `Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass` first, or continue directly).*

### Step 3: Install Required Dependencies
```powershell
pip install -r requirements.txt
```

### Step 4: Configure Your `.env` File
A default `.env` file is already created for you. You can check or customize it:
```ini
SECRET_KEY=dev-secret-key-waste-wise-2026
ADMIN_PASSCODE=admin123
GEMINI_API_KEY=
```
- **Demonstration Administrator Passcode**: Default is `admin123`.
- **Optional AI API**: If you have a Google Gemini API Key, paste it into `GEMINI_API_KEY=`. If you leave it empty, WasteWise will seamlessly use its built-in rule-based AI fallback.

### Step 5: Start the WasteWise Server
```powershell
python app.py
```

### Step 6: Open the Application
Open your web browser (Chrome, Edge, Firefox) and navigate to:
```text
http://127.0.0.1:5000/
```

---

## 🧪 Testing the Features

You can test all features right in the browser or via the automated test suite:

### Option A: Browser Walkthrough
1. **Submit a Waste Report**:
   - Scroll to the **"Report Waste Accumulation"** form.
   - Type a location (or click **Detect**).
   - Enter a description like: *"Broken television monitor and lithium batteries dumped by the road."*
   - Click **"Let AI Analyze This Description"** to see the AI assistant categorize it automatically as *Electronic Waste*.
   - Optionally upload a photo (`.png`, `.jpg`).
   - Click **Submit Waste Report**. A unique reference ID (e.g. `WW-20261026-A1B2C3`) is generated.
2. **Search & Filter**:
   - Scroll down to the **Live Tracker**.
   - Type keywords into the search box or filter by category/status.
   - Click **View** on any row to open the modal and inspect the full report details and photo.
3. **Demonstration Administrator Mode**:
   - Click **"Demo Admin"** in the top navigation bar.
   - Enter passcode: `admin123`.
   - The status column in the table turns into dropdown menus. Change any report from `Pending` &rarr; `In Progress` &rarr; `Resolved`.
   - Watch the top dashboard counter cards update in real time!

### Option B: Run Automated Unit Tests
Run the automated test suite verifying database operations, validation rules, upload constraints, and AI fallbacks:
```powershell
python test_app.py
```

---

## 🛡️ Hackathon Demonstration & Ethics Note
- Waste reports are stored securely in local SQLite persistent storage for civic and hackathon evaluation.
- As an ethical design choice, reports are not sent to external municipal dispatchers unless an official municipal gateway integration is configured.
