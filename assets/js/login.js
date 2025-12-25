/* =======================================================
   login.js
   Handles the Descope Login Widget logic.
   FIXED: Uses standard DOM element creation.
   ======================================================= */

const PROJECT_ID = "P2qXQxJA4H4hvSu2AnDB5VjKnh1d";

function loadLoginWidget() {
    const container = document.getElementById('descope-container');
    
    if(!container) {
        console.error("Login container not found");
        return;
    }

    // 1. Create the <descope-wc> HTML element dynamically
    const wc = document.createElement('descope-wc');

    // 2. Set the configuration attributes
    wc.setAttribute('project-id', PROJECT_ID);
    wc.setAttribute('flow-id', "sign-in"); // The name of your flow
    wc.setAttribute('theme', "light");

    // 3. Add Event Listeners for Success/Error
    wc.addEventListener('success', (e) => {
        console.log("Login Success:", e.detail.user);
        console.log("Session Token:", e.detail.sessionJwt);
        
        // Redirect to the main app
        window.location.href = "index.html"; 
    });

    wc.addEventListener('error', (e) => {
        console.error("Login Error:", e.detail);
        alert("Login failed. Please try again.");
    });

    // 4. Inject the widget into the page
    // Clear any loading text first
    container.innerHTML = "";
    container.appendChild(wc);
}

// Run when the page is ready
document.addEventListener("DOMContentLoaded", loadLoginWidget);
