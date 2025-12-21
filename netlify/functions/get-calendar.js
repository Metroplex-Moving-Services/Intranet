const fetch = require('node-fetch');

exports.handler = async function(event, context) {
  
  // 1. DEFINE CORS HEADERS
  // These headers allow your GitHub Pages site (or any site) to read this data.
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Content-Type": "application/json"
  };

  // 2. HANDLE "OPTIONS" REQUEST (Pre-flight check)
  // Browsers verify the connection with an OPTIONS request before sending the real data.
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 200,
      headers: headers,
      body: ""
    };
  }

  try {
    // 3. DEFINE ZOHO CONFIGURATION
    // Replace these with your actual Zoho credentials from your environment variables
    const REFRESH_TOKEN = process.env.ZOHO_REFRESH_TOKEN;
    const CLIENT_ID = process.env.ZOHO_CLIENT_ID;
    const CLIENT_SECRET = process.env.ZOHO_CLIENT_SECRET;
    
    // Your specific Zoho Creator Report details
    const OWNER_NAME = "information152"; // Your Zoho Owner Name
    const APP_LINK_NAME = "household-goods-moving-services";
    const REPORT_LINK_NAME = "Current_Bookings";

    // 4. GET ACCESS TOKEN FROM ZOHO
    // We exchange the long-lived Refresh Token for a short-lived Access Token
    const tokenUrl = `https://accounts.zoho.com/oauth/v2/token?refresh_token=${REFRESH_TOKEN}&client_id=${CLIENT_ID}&client_secret=${CLIENT_SECRET}&grant_type=refresh_token`;
    
    const tokenResponse = await fetch(tokenUrl, { method: 'POST' });
    const tokenData = await tokenResponse.json();
    
    if (tokenData.error) {
      console.error("Zoho Token Error:", tokenData.error);
      return {
        statusCode: 500,
        headers: headers,
        body: JSON.stringify({ error: "Failed to authenticate with Zoho." })
      };
    }
    
    const accessToken = tokenData.access_token;

    // 5. FETCH DATA FROM ZOHO CREATOR
    // We use the access token to get the actual calendar records
    const zohoDataUrl = `https://creator.zoho.com/api/v2/${OWNER_NAME}/${APP_LINK_NAME}/report/${REPORT_LINK_NAME}`;
    
    const dataResponse = await fetch(zohoDataUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Zoho-oauthtoken ${accessToken}`
      }
    });
    
    const zohoJson = await dataResponse.json();

    // 6. RETURN DATA TO FRONTEND
    if (zohoJson.code && zohoJson.code !== 3000) {
      // Zoho returned an application-level error (e.g., no records found)
      console.warn("Zoho API Warning:", zohoJson);
      // We still return 200 OK but with the error message so the frontend can handle it
      return {
        statusCode: 200,
        headers: headers,
        body: JSON.stringify({ data: [], message: "Zoho returned no data or an error." })
      };
    }

    // Success! Return the list of records
    return {
      statusCode: 200,
      headers: headers,
      body: JSON.stringify({
        data: zohoJson.data || [] // Ensure 'data' is always an array
      })
    };

  } catch (error) {
    // 7. CATCH & LOG SERVER ERRORS
    console.error("Function Error:", error);
    return {
      statusCode: 500,
      headers: headers,
      body: JSON.stringify({ error: "Internal Server Error", details: error.message })
    };
  }
};
