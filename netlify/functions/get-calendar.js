// netlify/functions/get-calendar.js
const https = require('https');

exports.handler = async function(event, context) {
    // 1. Get Environment Variables (We will set these in Netlify next)
    const { ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_REFRESH_TOKEN, ZOHO_OWNER, ZOHO_APP, ZOHO_REPORT } = process.env;

    // 2. Helper: Post to Zoho to get a fresh Access Token
    const getAccessToken = () => {
        return new Promise((resolve, reject) => {
            const path = '/oauth/v2/token?refresh_token=${ZOHO_REFRESH_TOKEN}&client_id=${ZOHO_CLIENT_ID}&client_secret=${ZOHO_CLIENT_SECRET}&grant_type=refresh_token';
            const req = https.request({
                hostname: 'accounts.zoho.com', // Change to accounts.zoho.eu if in Europe
                path: path,
                method: 'POST'
            }, (res) => {
                let data = '';
                res.on('data', (chunk) => data += chunk);
                res.on('end', () => resolve(JSON.parse(data).access_token));
            });
            req.on('error', reject);
            req.end();
        });
    };

    // 3. Helper: Get Data from Creator
    const getCreatorData = (accessToken) => {
        return new Promise((resolve, reject) => {
            const path = '/api/v2/${ZOHO_OWNER}/${ZOHO_APP}/report/${ZOHO_REPORT}';
            const req = https.request({
                hostname: 'creator.zoho.com', // Change to creator.zoho.eu if in Europe
                path: path,
                method: 'GET',
                headers: { 'Authorization': 'Zoho-oauthtoken ${accessToken}' }
            }, (res) => {
                let data = '';
                res.on('data', (chunk) => data += chunk);
                res.on('end', () => resolve(data));
            });
            req.on('error', reject);
            req.end();
        });
    };

    try {
        const token = await getAccessToken();
        const data = await getCreatorData(token);
        
        return {
            statusCode: 200,
            headers: {
                "Access-Control-Allow-Origin": "*", // Allows your GitHub page to read this
                "Content-Type": "application/json"
            },
            body: data
        };
    } catch (error) {
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }
};
