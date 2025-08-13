import { google } from 'googleapis';
import cron from 'node-cron';

// Login and get session cookie  
async function getSessionCookie() {  
	const loginUrl = 'https://mein.fitx.de/login';  
	const loginData = {  
		username: process.env.FITX_EMAIL,  
		password: process.env.FITX_PASSWORD  
	};

	try {  
		const response = await fetch(loginUrl, {  
			method: 'POST',  
			headers: {  
        		"x-nox-client-type": "WEB",
				'Authorization': 'Basic di5tYWhua2VAZ21haWwuY29tOjVuQ19XYTcyR0lXTS10Q21BbVox',  
				'Content-Type': 'application/json',  
				'x-public-facility-group': 'FITXDE-7B7DAC63E1744DE797245D6E314CD8F6',  
				'x-tenant': 'fitx'  ,
			},  
			body: JSON.stringify(loginData)
		});

		if (!response.ok) {  
			throw new Error(`Login failed with status ${response.status}`);  
		}

		const cookies = response.headers.get('set-cookie');  
		const sessionCookie = cookies.split(',').find(cookie => cookie.startsWith('SESSION='));  
		return sessionCookie.split(';')[0]; // Extract SESSION cookie  
	} catch (error) {  
		console.error('Error during login:', error);  
		throw error;  
	}  
}

function formatDate(dateWithoutLeadingZeroes) {
    dateWithoutLeadingZeroes = typeof dateWithoutLeadingZeroes === 'object' ? dateWithoutLeadingZeroes.date : dateWithoutLeadingZeroes;
    const [month, day, year] = dateWithoutLeadingZeroes.replace(/-/g, '/').split('/');
    const mm = month.padStart(2, '0');
    const dd = day.padStart(2, '0');
    return `${mm}/${dd}/${year}`;
}

// Fetch check-in history  
async function fetchCheckinHistory(sessionCookie) {  
	const historyUrl = 'https://mein.fitx.de/nox/v1/studios/checkin/history/report';  
	const today = new Date();  
	const lastYear = new Date(today);  
	lastYear.setFullYear(today.getFullYear() - 1);

	const from = lastYear.toISOString().split('T')[0];  
	const to = today.toISOString().split('T')[0];

	try {  
		const response = await fetch(`${historyUrl}?from=${from}&to=${to}`, {  
			method: 'GET',  
			headers: {  
				Cookie: sessionCookie,
        		"x-nox-client-type": "WEB",
				'Authorization': 'Basic di5tYWhua2VAZ21haWwuY29tOjVuQ19XYTcyR0lXTS10Q21BbVox', 
				'Content-Type': 'application/json',  
				'x-public-facility-group': 'FITXDE-7B7DAC63E1744DE797245D6E314CD8F6',  
				'x-tenant': 'fitx' 
			}  
		});

		if (!response.ok) {  
			throw new Error(`Failed to fetch check-in history with status ${response.status}: ${await response.text()}`);  
		}

        const data = await response.json();
        // Ensure all dates are in MM/DD/YYYY format with leading zeroes
        return data.map(formatDate);
	} catch (error) {  
		console.error('Error fetching check-in history:', error);  
		throw error;  
	}  
}

// Google Sheets API setup
const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const TAB_NAME = 'Trainings';
// Use credentials from GCP_CREDENTIALS_JSON environment variable
async function awaitSetInSheet(checkinHistory) {
	if (!process.env.GCP_CREDENTIALS) {
		throw new Error('GCP_CREDENTIALS environment variable not set.');
	}
	const credentials = JSON.parse(process.env.GCP_CREDENTIALS);

    const auth = new google.auth.GoogleAuth({
        credentials,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    const sheets = google.sheets({ version: 'v4', auth: await auth.getClient() });

    // Get all dates in column A
    const range = `${TAB_NAME}!A:A`;
    const res = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range,
    });
	const existingDates = new Set((res.data.values || []).flat().map(v => v.trim()));

    // Prepare new dates to append
    const newDates = checkinHistory
        .map(formatDate)
        .filter(date => !existingDates.has(date))
        .map(date => [date]);

    if (newDates.length === 0) {
        console.log('No new dates to add.');
        return;
    }

    // Append new dates
    await sheets.spreadsheets.values.append({
        spreadsheetId: SHEET_ID,
        range,
        valueInputOption: 'USER_ENTERED',
        insertDataOption: 'INSERT_ROWS',
        resource: { values: newDates },
    });

    console.log(`Added ${newDates.length} new date(s) to the sheet.`);
}

const task = cron.schedule('0 0 * * *', runJob);

async function runJob() {
	try {  
		const sessionCookie = await getSessionCookie();  
		const checkinHistory = await fetchCheckinHistory(sessionCookie);

		// Log all dates  
		checkinHistory.forEach(entry => {  
			console.log(entry.date);  
		});  

		await awaitSetInSheet(checkinHistory);

		console.log("Next run at: " + task.getNextRun());

	} catch (error) {  
		console.error('An error occurred:', error);  
	}  
}

console.log(`Running at startup: '${process.env.RUN_AT_STARTUP?.toLowerCase() === 'true'}'`);
if (process.env.RUN_AT_STARTUP?.toLowerCase() === 'true') {
	runJob();
}

console.log('Scheduled job to run every 24 hours.');