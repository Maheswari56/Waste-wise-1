import os
import io
import json
import shutil
import tempfile
import unittest
from app import app, init_db, DATABASE_PATH, UPLOAD_FOLDER, rule_based_assistant, format_nominatim_address

class WasteWiseTestCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Create an isolated temporary directory for testing database and photo uploads
        cls.test_dir = tempfile.mkdtemp(prefix="wastewise_test_")
        cls.test_db_path = os.path.join(cls.test_dir, "test_database.db")
        cls.test_upload_folder = os.path.join(cls.test_dir, "test_uploads")
        os.makedirs(cls.test_upload_folder, exist_ok=True)

        # Configure app to use isolated temporary paths
        app.config['TESTING'] = True
        app.config['WTF_CSRF_ENABLED'] = False
        app.config['DATABASE_PATH'] = cls.test_db_path
        app.config['UPLOAD_FOLDER'] = cls.test_upload_folder

        # Initialize the isolated test database schema
        init_db()

    @classmethod
    def tearDownClass(cls):
        # Restore app original configurations
        app.config['DATABASE_PATH'] = DATABASE_PATH
        app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
        app.config['TESTING'] = False

        # Safely remove the isolated test directory (test database + test uploaded files)
        if os.path.exists(cls.test_dir):
            shutil.rmtree(cls.test_dir, ignore_errors=True)

    def setUp(self):
        self.client = app.test_client()

    def test_01_home_page_loads(self):
        response = self.client.get('/')
        self.assertEqual(response.status_code, 200)
        self.assertIn(b'WasteWise', response.data)
        self.assertIn(b'Report Waste. Protect Our Planet.', response.data)

    def test_02_stats_api(self):
        response = self.client.get('/api/stats')
        self.assertEqual(response.status_code, 200)
        data = json.loads(response.data)
        self.assertTrue(data['success'])
        self.assertIn('total', data)
        self.assertIn('pending', data)
        self.assertIn('in_progress', data)
        self.assertIn('resolved', data)

    def test_03_create_report_validation_failures(self):
        # Missing required fields
        res = self.client.post('/api/reports', data={})
        self.assertEqual(res.status_code, 400)
        
        # Short description
        res = self.client.post('/api/reports', data={
            'category': 'Plastic',
            'location': 'Central Park',
            'description': 'abc',
            'severity': 'Low'
        })
        self.assertEqual(res.status_code, 400)

    def test_04_create_report_success(self):
        payload = {
            'reporter_name': 'Test Citizen',
            'category': 'Plastic',
            'location': 'Corner of 4th Avenue and Elm St',
            'description': 'Overfilled recycling bin with plastic soda bottles all over sidewalk.',
            'severity': 'Medium'
        }
        res = self.client.post('/api/reports', data=payload)
        self.assertEqual(res.status_code, 201)
        data = json.loads(res.data)
        self.assertTrue(data['success'])
        self.assertIn('WW-', data['report_id'])
        self.created_id = data['report_id']

    def test_05_create_report_with_image_upload(self):
        data = {
            'reporter_name': 'Green Volunteer',
            'category': 'Electronic Waste',
            'location': 'Community Center Alley',
            'description': 'Discarded lithium computer batteries and monitors.',
            'severity': 'High',
            'photo': (io.BytesIO(b"fake image bytes for test"), 'test_image.png')
        }
        res = self.client.post('/api/reports', data=data, content_type='multipart/form-data')
        self.assertEqual(res.status_code, 201)
        resp_data = json.loads(res.data)
        self.assertTrue(resp_data['success'])

        # Verify photo was written into the isolated test upload folder, not the production upload folder
        test_uploads = os.listdir(self.test_upload_folder)
        self.assertGreaterEqual(len(test_uploads), 1)

    def test_06_invalid_file_extension(self):
        data = {
            'reporter_name': 'Tester',
            'category': 'General Waste',
            'location': 'Main Rd',
            'description': 'Rubble left after road construction.',
            'severity': 'Low',
            'photo': (io.BytesIO(b"executable code"), 'malicious.exe')
        }
        res = self.client.post('/api/reports', data=data, content_type='multipart/form-data')
        self.assertEqual(res.status_code, 400)
        resp_data = json.loads(res.data)
        self.assertFalse(resp_data['success'])

    def test_07_search_and_filter(self):
        # Create a report for search test
        self.client.post('/api/reports', data={
            'reporter_name': 'UniqueUserX',
            'category': 'Medical Waste',
            'location': 'Apex Hospital Gate 3',
            'description': 'Discarded medical syringes on grass verge.',
            'severity': 'High'
        })

        # Test location search
        res = self.client.get('/api/reports?search=Apex+Hospital')
        self.assertEqual(res.status_code, 200)
        data = json.loads(res.data)
        self.assertGreaterEqual(len(data['reports']), 1)
        self.assertEqual(data['reports'][0]['category'], 'Medical Waste')

        # Test category filter
        res = self.client.get('/api/reports?category=Medical+Waste')
        data = json.loads(res.data)
        for r in data['reports']:
            self.assertEqual(r['category'], 'Medical Waste')

    def test_08_admin_authorization_and_status_update(self):
        # Create a report
        create_res = self.client.post('/api/reports', data={
            'reporter_name': 'Civic Watch',
            'category': 'Food Waste',
            'location': 'Vegetable Market Shed 2',
            'description': 'Rotten food waste generating strong foul odor.',
            'severity': 'High'
        })
        rep_id = json.loads(create_res.data)['report_id']

        # Unauthorized attempt without admin login
        unauth_res = self.client.patch(f'/api/reports/{rep_id}/status', json={'status': 'In Progress'})
        self.assertEqual(unauth_res.status_code, 403)

        # Admin login
        login_res = self.client.post('/api/admin/login', json={'passcode': 'admin123'})
        self.assertEqual(login_res.status_code, 200)

        # Update status
        update_res = self.client.patch(f'/api/reports/{rep_id}/status', json={'status': 'In Progress'})
        self.assertEqual(update_res.status_code, 200)

        # Verify update in GET
        fetch_res = self.client.get(f'/api/reports?search={rep_id}')
        fetched = json.loads(fetch_res.data)['reports']
        self.assertEqual(fetched[0]['status'], 'In Progress')

    def test_09_ai_assistant_fallback(self):
        # Test rule-based assistant without external API key
        res = self.client.post('/api/ai/categorize', json={
            'description': 'Pile of empty plastic water bottles and wrappers on sidewalk'
        })
        self.assertEqual(res.status_code, 200)
        data = json.loads(res.data)['data']
        self.assertEqual(data['category'], 'Plastic')
        self.assertIn('disposal_guidance', data)
        self.assertIn('environmental_risks', data)

        # Test electronic waste rule
        res_e = self.client.post('/api/ai/categorize', json={
            'description': 'Old laptop with swollen battery and loose cables'
        })
        self.assertEqual(res_e.status_code, 200)
        data_e = json.loads(res_e.data)['data']
        self.assertEqual(data_e['category'], 'Electronic Waste')

    def test_10_address_formatting_logic(self):
        sample_address = {
            'road': 'Anna Salai',
            'suburb': 'Guindy',
            'city': 'Chennai',
            'state_district': 'Chennai',
            'state': 'Tamil Nadu',
            'postcode': '600032'
        }
        formatted = format_nominatim_address(sample_address)
        self.assertIn('Guindy', formatted)
        self.assertIn('Chennai', formatted)
        self.assertIn('Tamil Nadu', formatted)
        self.assertIn('600032', formatted)

    def test_11_reverse_geocode_api_validation_and_fallback(self):
        # Missing coordinates
        res = self.client.get('/api/geocode/reverse')
        self.assertEqual(res.status_code, 400)

        # Invalid coordinate boundaries
        res = self.client.get('/api/geocode/reverse?lat=120.5&lon=80.1')
        self.assertEqual(res.status_code, 400)

        # Valid coordinates (should either resolve address or gracefully return GPS fallback)
        res = self.client.get('/api/geocode/reverse?lat=12.33390&lon=79.78446')
        self.assertEqual(res.status_code, 200)
        data = json.loads(res.data)
        self.assertIn('lat', data)
        self.assertIn('lon', data)
        if data['success']:
            self.assertIsNotNone(data['address'])
        else:
            self.assertIn('fallback', data)
            self.assertTrue(data['fallback'].startswith('GPS:'))

if __name__ == '__main__':
    unittest.main()
