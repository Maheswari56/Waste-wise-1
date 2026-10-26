import os
import re
import uuid
import sqlite3
import requests
from datetime import datetime, timezone
from flask import Flask, render_template, request, jsonify, send_from_directory, redirect, url_for, session
from werkzeug.utils import secure_filename
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

BASE_DIR = os.path.abspath(os.path.dirname(__file__))
DATABASE_PATH = os.path.join(BASE_DIR, 'database.db')
UPLOAD_FOLDER = os.path.join(BASE_DIR, 'uploads')
ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif', 'webp'}
MAX_CONTENT_LENGTH = 8 * 1024 * 1024  # 8MB max upload size

os.makedirs(UPLOAD_FOLDER, exist_ok=True)

app = Flask(__name__)
app.secret_key = os.getenv('SECRET_KEY', 'waste-wise-default-secret-key-2026')
app.config['DATABASE_PATH'] = DATABASE_PATH
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
app.config['MAX_CONTENT_LENGTH'] = MAX_CONTENT_LENGTH

ADMIN_PASSCODE = os.getenv('ADMIN_PASSCODE', 'admin123')
GEMINI_API_KEY = os.getenv('GEMINI_API_KEY', '').strip()

CATEGORIES = ['Plastic', 'Food Waste', 'Electronic Waste', 'Medical Waste', 'General Waste']
SEVERITIES = ['Low', 'Medium', 'High']
STATUSES = ['Pending', 'In Progress', 'Resolved']

def get_db_connection():
    db_path = app.config.get('DATABASE_PATH', DATABASE_PATH)
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS reports (
            id TEXT PRIMARY KEY,
            reporter_name TEXT,
            category TEXT NOT NULL,
            location TEXT NOT NULL,
            description TEXT NOT NULL,
            severity TEXT NOT NULL,
            photo_filename TEXT,
            status TEXT NOT NULL DEFAULT 'Pending',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    conn.commit()
    conn.close()

init_db()

# In-memory geocoding cache to avoid repeated requests to Nominatim
GEOCODE_CACHE = {}

def format_nominatim_address(address_dict):
    """
    Format address details from Nominatim reverse geocode response into
    a human-readable address with locality, town/city, district, state, and postal code.
    """
    if not isinstance(address_dict, dict):
        return None

    # 1. Locality / Immediate neighborhood
    locality = (
        address_dict.get('suburb') or
        address_dict.get('neighbourhood') or
        address_dict.get('residential') or
        address_dict.get('road') or
        address_dict.get('village') or
        address_dict.get('hamlet')
    )

    # 2. City / Town
    city_town = (
        address_dict.get('city') or
        address_dict.get('town') or
        address_dict.get('municipality') or
        address_dict.get('village')
    )

    # 3. District / County
    district = (
        address_dict.get('county') or
        address_dict.get('state_district') or
        address_dict.get('district')
    )

    # 4. State
    state = address_dict.get('state')

    # 5. Postal Code
    postcode = address_dict.get('postcode')

    # Build parts list ensuring no duplicate adjacent entries
    parts = []
    for item in [locality, city_town, district, state, postcode]:
        if item and str(item).strip() and str(item).strip() not in parts:
            parts.append(str(item).strip())

    if parts:
        return ", ".join(parts)
    return None

def reverse_geocode_nominatim(lat, lon):
    """
    Reverse geocode coordinates using OpenStreetMap Nominatim.
    Respects OSM Nominatim Usage Policy (custom User-Agent, timeout, caching).
    """
    cache_key = f"{round(float(lat), 4)},{round(float(lon), 4)}"
    if cache_key in GEOCODE_CACHE:
        return GEOCODE_CACHE[cache_key]

    headers = {
        'User-Agent': 'WasteWise-SmartWasteReportingSystem/1.0 (HackOctober 2026 civic hackathon demo; contact: demo@wastewise.local)',
        'Accept-Language': 'en'
    }
    url = f"https://nominatim.openstreetmap.org/reverse?lat={lat}&lon={lon}&format=jsonv2&addressdetails=1"

    try:
        resp = requests.get(url, headers=headers, timeout=5)
        if resp.status_code == 200:
            data = resp.json()
            address_info = data.get('address', {})
            formatted = format_nominatim_address(address_info)
            if not formatted and data.get('display_name'):
                formatted = data.get('display_name')

            res_payload = {
                "success": bool(formatted),
                "address": formatted,
                "raw_address": address_info,
                "display_name": data.get('display_name')
            }
            if formatted:
                GEOCODE_CACHE[cache_key] = res_payload
            return res_payload
        else:
            return {"success": False, "address": None, "error": f"Nominatim status {resp.status_code}"}
    except Exception as e:
        return {"success": False, "address": None, "error": str(e)}

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

# Rule-based fallback for waste categorization & disposal
def rule_based_assistant(description):
    desc = description.lower()
    
    # Keyword analysis
    medical_keywords = ['syringe', 'needle', 'bandage', 'pill', 'medicine', 'hospital', 'mask', 'gauze', 'pharma', 'blood', 'clinic']
    electronic_keywords = ['battery', 'phone', 'cable', 'laptop', 'computer', 'circuit', 'screen', 'monitor', 'tv', 'wire', 'electronic', 'charger', 'appliance', 'gadget']
    food_keywords = ['food', 'fruit', 'vegetable', 'meat', 'peel', 'leftover', 'rotten', 'bread', 'kitchen', 'organic', 'compost', 'meal', 'spoil']
    plastic_keywords = ['bottle', 'bag', 'wrapper', 'container', 'straw', 'plastic', 'polythene', 'cup', 'pouch', 'packaging', 'sachet']
    
    if any(k in desc for k in medical_keywords):
        category = 'Medical Waste'
        guidance = "Separate into leak-proof biohazard containers or puncture-resistant sharps disposal boxes. Never mix with household trash. Keep away from water sources and unauthorized contact."
        risks = "Poses severe biohazard risks, infectious disease transmission (e.g. Hepatitis, HIV), sharp injury hazards, and contamination of groundwater through toxic pharmaceuticals."
    elif any(k in desc for k in electronic_keywords):
        category = 'Electronic Waste'
        guidance = "Take to a certified e-waste recycler or municipal drop-off depot. Remove rechargeable batteries if possible and tape battery terminals."
        risks = "Releases heavy metals such as lead, mercury, and cadmium into soil and drinking water. Non-biodegradable components poison ecosystems and harm long-term human health."
    elif any(k in desc for k in food_keywords):
        category = 'Food Waste'
        guidance = "Divert to municipal wet-waste collection or an aerobic home/community composter. Keep separate from plastics and dry recyclables."
        risks = "Decomposes anaerobically in open dumps to generate potent methane gas (greenhouse gas 28x stronger than CO2), foul odors, and attracts disease vectors like flies and rodents."
    elif any(k in desc for k in plastic_keywords):
        category = 'Plastic'
        guidance = "Rinse free of grease and organic residue. Crush bottles and deposit in dedicated dry recyclable bins for municipal recovery or recycling."
        risks = "Takes hundreds of years to break down. Degrades into toxic microplastics that enter the food chain, block drainage systems causing urban flooding, and endanger wildlife."
    else:
        category = 'General Waste'
        guidance = "Bag securely in heavy-duty refuse bags and place in designated municipal non-recyclable solid waste collection receptacles."
        risks = "Contributes to open dumpsite accumulation, visual pollution, foul smells, and can spark landfill fires if not cleared promptly."
        
    return {
        "category": category,
        "disposal_guidance": guidance,
        "environmental_risks": risks,
        "source": "Rule-based Waste Intelligence Fallback"
    }

def gemini_waste_assistant(description):
    if not GEMINI_API_KEY:
        return rule_based_assistant(description)
        
    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key={GEMINI_API_KEY}"
    prompt = f"""
You are an expert environmental and waste management assistant. Analyze this user description of waste:
"{description}"

Respond ONLY with a JSON object in this exact format (no markdown fences, just JSON):
{{
  "category": "one of: Plastic, Food Waste, Electronic Waste, Medical Waste, General Waste",
  "disposal_guidance": "Concise step-by-step citizen instructions on how to handle/dispose safely (max 2 sentences)",
  "environmental_risks": "Simple explanation of environmental & health hazards if left untreated (max 2 sentences)"
}}
"""
    try:
        payload = {
            "contents": [{
                "parts": [{"text": prompt}]
            }],
            "generationConfig": {
                "temperature": 0.2,
                "maxOutputTokens": 300
            }
        }
        res = requests.post(url, json=payload, timeout=8)
        if res.status_code == 200:
            data = res.json()
            text = data['candidates'][0]['content']['parts'][0]['text'].strip()
            # Clean markdown code block if present
            if text.startswith('```'):
                text = re.sub(r'^```(json)?\n', '', text)
                text = re.sub(r'```$', '', text).strip()
            import json
            parsed = json.loads(text)
            # Ensure valid category
            if parsed.get('category') not in CATEGORIES:
                parsed['category'] = 'General Waste'
            parsed['source'] = 'Google Gemini AI'
            return parsed
        else:
            # Fallback to rule-based with note
            fb = rule_based_assistant(description)
            fb['source'] = f"Rule-based (Gemini API HTTP {res.status_code})"
            return fb
    except Exception as e:
        fb = rule_based_assistant(description)
        fb['source'] = f"Rule-based (AI unreachable: {type(e).__name__})"
        return fb

# Routes
@app.route('/')
def index():
    return render_template('index.html', admin_mode=session.get('is_admin', False))

@app.route('/uploads/<path:filename>')
def serve_upload(filename):
    return send_from_directory(app.config['UPLOAD_FOLDER'], filename)

@app.route('/api/stats', methods=['GET'])
def get_stats():
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('SELECT COUNT(*) as total FROM reports')
    total = cursor.fetchone()['total']
    
    cursor.execute("SELECT COUNT(*) as pending FROM reports WHERE status = 'Pending'")
    pending = cursor.fetchone()['pending']
    
    cursor.execute("SELECT COUNT(*) as in_progress FROM reports WHERE status = 'In Progress'")
    in_progress = cursor.fetchone()['in_progress']
    
    cursor.execute("SELECT COUNT(*) as resolved FROM reports WHERE status = 'Resolved'")
    resolved = cursor.fetchone()['resolved']
    
    conn.close()
    return jsonify({
        "success": True,
        "total": total,
        "pending": pending,
        "in_progress": in_progress,
        "resolved": resolved
    })

@app.route('/api/reports', methods=['GET'])
def get_reports():
    search = request.args.get('search', '').strip()
    category = request.args.get('category', '').strip()
    status = request.args.get('status', '').strip()
    
    query = "SELECT * FROM reports WHERE 1=1"
    params = []
    
    if search:
        query += " AND (location LIKE ? OR description LIKE ? OR id LIKE ?)"
        wildcard = f"%{search}%"
        params.extend([wildcard, wildcard, wildcard])
        
    if category and category != 'All':
        query += " AND category = ?"
        params.append(category)
        
    if status and status != 'All':
        query += " AND status = ?"
        params.append(status)
        
    query += " ORDER BY created_at DESC"
    
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(query, params)
    rows = cursor.fetchall()
    
    reports = []
    for r in rows:
        reports.append({
            "id": r['id'],
            "reporter_name": r['reporter_name'] or 'Anonymous Citizen',
            "category": r['category'],
            "location": r['location'],
            "description": r['description'],
            "severity": r['severity'],
            "photo_filename": r['photo_filename'],
            "status": r['status'],
            "created_at": r['created_at'],
            "updated_at": r['updated_at']
        })
    conn.close()
    return jsonify({"success": True, "reports": reports})

@app.route('/api/reports', methods=['POST'])
def create_report():
    try:
        reporter_name = request.form.get('reporter_name', '').strip()
        category = request.form.get('category', '').strip()
        location = request.form.get('location', '').strip()
        description = request.form.get('description', '').strip()
        severity = request.form.get('severity', '').strip()
        
        # Validation
        if not category or category not in CATEGORIES:
            return jsonify({"success": False, "message": f"Valid category required ({', '.join(CATEGORIES)})"}), 400
        if not location:
            return jsonify({"success": False, "message": "Location is required."}), 400
        if not description or len(description) < 5:
            return jsonify({"success": False, "message": "Description must be at least 5 characters long."}), 400
        if not severity or severity not in SEVERITIES:
            return jsonify({"success": False, "message": f"Valid severity required ({', '.join(SEVERITIES)})"}), 400
            
        saved_filename = None
        if 'photo' in request.files:
            file = request.files['photo']
            if file and file.filename != '':
                if not allowed_file(file.filename):
                    return jsonify({"success": False, "message": "Invalid file format. Allowed: PNG, JPG, JPEG, GIF, WEBP"}), 400
                
                # Check file extension and generate unique secure name
                ext = file.filename.rsplit('.', 1)[1].lower()
                clean_name = secure_filename(file.filename)
                unique_name = f"{uuid.uuid4().hex[:12]}_{clean_name}"
                file_path = os.path.join(app.config['UPLOAD_FOLDER'], unique_name)
                file.save(file_path)
                saved_filename = unique_name
                
        # Generate unique human-readable report ID
        report_id = f"WW-{datetime.now(timezone.utc).strftime('%Y%m%d')}-{uuid.uuid4().hex[:6].upper()}"
        
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute('''
            INSERT INTO reports (id, reporter_name, category, location, description, severity, photo_filename, status, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'Pending', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ''', (report_id, reporter_name if reporter_name else None, category, location, description, severity, saved_filename))
        conn.commit()
        conn.close()
        
        return jsonify({
            "success": True,
            "message": "Waste report submitted successfully!",
            "report_id": report_id
        }), 201
        
    except Exception as e:
        return jsonify({"success": False, "message": f"Server error: {str(e)}"}), 500

@app.route('/api/geocode/reverse', methods=['GET'])
def api_reverse_geocode():
    lat = request.args.get('lat', '').strip()
    lon = request.args.get('lon', '').strip()

    if not lat or not lon:
        return jsonify({"success": False, "message": "Latitude and longitude required"}), 400

    try:
        lat_f = float(lat)
        lon_f = float(lon)
        if not (-90.0 <= lat_f <= 90.0 and -180.0 <= lon_f <= 180.0):
            return jsonify({"success": False, "message": "Coordinates out of bounds"}), 400
    except ValueError:
        return jsonify({"success": False, "message": "Invalid numeric coordinates"}), 400

    geo_res = reverse_geocode_nominatim(lat_f, lon_f)
    if geo_res.get('success') and geo_res.get('address'):
        return jsonify({
            "success": True,
            "address": geo_res['address'],
            "lat": lat_f,
            "lon": lon_f
        })
    else:
        # Graceful fallback indication
        fallback_gps = f"GPS: {lat_f:.5f}, {lon_f:.5f}"
        return jsonify({
            "success": False,
            "address": None,
            "fallback": fallback_gps,
            "message": geo_res.get('error', 'Reverse geocoding service unavailable'),
            "lat": lat_f,
            "lon": lon_f
        })

@app.route('/api/admin/login', methods=['POST'])
def admin_login():
    data = request.get_json(silent=True) or {}
    passcode = data.get('passcode', '').strip()
    if passcode == ADMIN_PASSCODE:
        session['is_admin'] = True
        return jsonify({"success": True, "message": "Administrator authenticated successfully."})
    return jsonify({"success": False, "message": "Incorrect administrator passcode."}), 401

@app.route('/api/admin/logout', methods=['POST'])
def admin_logout():
    session.pop('is_admin', None)
    return jsonify({"success": True, "message": "Logged out from administrator mode."})

@app.route('/api/admin/status', methods=['GET'])
def admin_status():
    return jsonify({"is_admin": session.get('is_admin', False)})

@app.route('/api/reports/<report_id>/status', methods=['PATCH'])
def update_report_status(report_id):
    if not session.get('is_admin', False):
        # Also check authorization header or passcode in body for convenience
        req_data = request.get_json(silent=True) or {}
        passcode = req_data.get('passcode', '')
        if passcode != ADMIN_PASSCODE:
            return jsonify({"success": False, "message": "Unauthorized. Demonstration Administrator passcode required to update status."}), 403
            
    req_data = request.get_json(silent=True) or {}
    new_status = req_data.get('status', '').strip()
    
    if new_status not in STATUSES:
        return jsonify({"success": False, "message": f"Invalid status. Must be one of: {', '.join(STATUSES)}"}), 400
        
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT id FROM reports WHERE id = ?", (report_id,))
    if not cursor.fetchone():
        conn.close()
        return jsonify({"success": False, "message": "Report not found."}), 404
        
    cursor.execute('''
        UPDATE reports 
        SET status = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
    ''', (new_status, report_id))
    conn.commit()
    conn.close()
    
    return jsonify({"success": True, "message": f"Report {report_id} updated to '{new_status}'."})

@app.route('/api/ai/categorize', methods=['POST'])
def ai_categorize():
    data = request.get_json(silent=True) or {}
    description = data.get('description', '').strip()
    if not description:
        return jsonify({"success": False, "message": "Please enter a waste description to analyze."}), 400
        
    result = gemini_waste_assistant(description)
    return jsonify({
        "success": True,
        "data": result
    })

if __name__ == '__main__':
    # Default local port 5000
    app.run(host='127.0.0.1', port=5000, debug=True)
