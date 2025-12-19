// netlify/functions/get-calendar.js
const https = require('https');
const querystring = require('querystring'); // We use this to format the body correctly

exports.handler = async function(event, context) {
    
    // 1. Get and CLEAN the variables (Remove hidden spaces/newlines)
    const ZOHO_CLIENT_ID = process.env.ZOHO_CLIENT_ID ? process.env.ZOHO_CLIENT_ID.trim() : "";
    const ZOHO_CLIENT_SECRET = process.env.ZOHO_CLIENT_SECRET ? process.env.ZOHO_CLIENT_SECRET.trim() : "";
    const ZOHO_REFRESH_TOKEN = process.env.ZOHO_REFRESH_TOKEN ? process.env.ZOHO_REFRESH_TOKEN.trim() : "";
    
    const ZOHO_OWNER = process.env.ZOHO_OWNER ? process.env.ZOHO_OWNER.trim() : "";
    const ZOHO_APP = process.env.ZOHO_APP ? process.env.ZOHO_APP.trim() : "";
    const ZOHO_REPORT = process.env.ZOHO_REPORT ? process.env.ZOHO_REPORT.trim() : "";

    // 2. Helper: Get Access Token (POST via BODY, not URL - safer)
    const getAccessToken = () => {
        return new Promise((resolve, reject) => {
            
            // Prepare the data for the Body
            const postData = querystring.stringify({
                refresh_token: ZOHO_REFRESH_TOKEN,
                client_id: ZOHO_CLIENT_ID,
                client_secret: ZOHO_CLIENT_SECRET,
                grant_type: 'refresh_token'
            });

            const options = {
                hostname: 'accounts.zoho.com', // Change to accounts.zoho.eu if needed
                path: '/oauth/v2/token',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Content-Length': postData.length
                }
            };

            const req = https.request(options, (res) => {
                let data = '';
                res.on('data', (chunk) => data += chunk);
                res.on('end', () => {
                    try {
                        const json = JSON.parse(data);
                        if (json.error) reject(new Error("Zoho Auth Error: " + json.error));
                        resolve(json.access_token);
                    } catch (e) {
                        // This catches the "<!doctype" error if it happens again
                        console.error("Zoho sent HTML instead of JSON:", data);
                        reject(new Error("Zoho returned HTML (Likely 404 or Bad URL)"));
                    }
                });
            });

            req.on('error', (e) => reject(e));
            
            // Send the body data
            req.write(postData);
            req.end();
        });
    };

    // 3. Helper: Get Data from Creator
    const getCreatorData = (accessToken) => {
        return new Promise((resolve, reject) => {
            const path = '/api/v2/${ZOHO_OWNER}/${ZOHO_APP}/report/${ZOHO_REPORT}';
            
            const req = https.request({
                hostname: 'creatorapp.zoho.com', // Change to creator.zoho.eu if needed
                path: path,
                method: 'GET',
                headers: { 
                    'Authorization': 'Zoho-oauthtoken ${accessToken}',
                    'Content-Type': 'application/json'
                }
            }, (res) => {
                let data = '';
                res.on('data', (chunk) => data += chunk);
                res.on('end', () => {
                    try {
                        // Try to parse JSON, if it fails, it's HTML error page
                        const json = JSON.parse(data);
                        resolve(json);
                    } catch (e) {
                        console.error("Creator sent HTML:", data);
                        reject(new Error("Zoho Creator returned HTML (Check App/Owner/Report names)"));
                    }
                });
            });
            req.on('error', reject);
            req.end();
        });
    };

    try {
        if (!ZOHO_REFRESH_TOKEN) throw new Error("Missing ZOHO_REFRESH_TOKEN");

        const token = await getAccessToken();
        if (!token) throw new Error("Failed to get Access Token");

        const data = await getCreatorData(token);
        
        return {
            statusCode: 200,
            headers: {
                "Access-Control-Allow-Origin": "*",
                "Content-Type": "application/json"
            },
            body: JSON.stringify(data)
        };
    } catch (error) {
        console.error("Function Crash:", error.message);
        return { 
            statusCode: 500, 
            headers: {
                "Access-Control-Allow-Origin": "*",
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ error: error.message }) 
        };
    }
};