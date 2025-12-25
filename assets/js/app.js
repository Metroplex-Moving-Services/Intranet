/* =======================================================
   app.js
   Main Controller: Auth, Navigation (setiFrame), and Logic.
   ======================================================= */

const PROJECT_ID = "P2qXQxJA4H4hvSu2AnDB5VjKnh1d";

// 1. Initialize SDK
window.sdk = Descope({ projectId: PROJECT_ID, persistTokens: true, autoRefresh: true });

// Global Variables for your logic
window.userRole = []; // Will hold roles like "Hoobastank", "Phish"

// 2. Startup Function
async function initApp() {
    console.log("App initializing...");
    
    const sessionToken = window.sdk.getSessionToken();
    
    if (sessionToken) {
        try {
            // Fetch User
            const user = await window.sdk.me();
            window.user = user; 
            
            // --- CRITICAL: Map Descope Roles to your global variable ---
            // This ensures userRole.includes("Hoobastank") works in setiFrame
            window.userRole = (user.data && user.data.roleNames) || user.roleNames || [];
            console.log("User Roles loaded:", window.userRole);

            // UI Reset
            $("#loading").hide();
            $("#app").show();

            // Load Homepage if empty
            const iframe = document.getElementById("contentFrame");
            if (iframe && !iframe.src) {
                setiFrame('empty'); // Use your function to load home
            }

        } catch (err) {
            console.error("Session invalid:", err);
            handleLogout();
        }
    } else {
        window.location.href = "login.html";
    }
}

// 3. YOUR LOGIC: setiFrame (Refactored)
window.setiFrame = function(purpose) {
    console.log("Navigating to:", purpose);
    
    // Define the Frame
    const MMSiFrame = document.getElementById("contentFrame");
    
    // Show Loading Overlay (Requires gasparesganga-jquery-loading-overlay)
    if ($.LoadingOverlay) {
        $.LoadingOverlay("show", {
            imageColor: "#0C419a",
            imageAnimation: "8000ms pulse"
        });
    }

    // Clear current source
    MMSiFrame.removeAttribute("src");

    // --- NAVIGATION LOGIC ---

    if (purpose == 'newcalendar') {
        MMSiFrame.src = "pages/calendar.html"; 
        hideLoader(1000);
    }
    
    else if (purpose == 'calendar') {
        // External Zoho Link
        MMSiFrame.src = "https://creatorapp.zohopublic.com/information152/household-goods-moving-services/report-embed/Current_Bookings/UVe6stDyTr0Ofd0v8d5YJhGDph0pBaGuBxAAXgnZSMXh6ZgYNTH7aQmQB3UR8G9hxwQ9w9wdeddG74rrA8H7V7TeWWVQtHP9jVzE";
        hideLoader(2000);
    }
    
    else if (purpose == 'addmovertojob') {
        if (checkRole("Hoobastank")) {
            MMSiFrame.src = "https://creatorapp.zohopublic.com/information152/household-goods-moving-services/form-embed/Add_Mover_To_Job/K94Pj9Q02ZQxseasgKf3RRvjqk8A5rC6CREEXtMW14vx3rhJx78x8JFxuke5XTgv1RDEjXm5Qv9AY9bD0rCC6wdAfvhnRTH4GVF4";
            hideLoader(1000);
        } else {
            MMSiFrame.src = "pages/needmoreprivileges.html";
            hideLoader(500);
        }
    }
    
    else if (purpose == 'createinvoice') {
        if (checkRole("Phish")) {
            MMSiFrame.src = "https://creatorapp.zohopublic.com/information152/household-goods-moving-services/form-embed/Create_Stripe_Invoice1/msx9v92BZjs4KNG3QyNAPQSQxY3uOyVaCQMtSOj942pEHzSBhaUmmwvfeDpNPttGEsh3mXGJRvwh55p5Us4hTfbbabw8hZ4ZVG95";
            hideLoader(1000);
        } else {
            MMSiFrame.src = "pages/needmoreprivileges.html";
            hideLoader(500);
        }
    }
    
    else if (purpose == 'myprofile') {
        MMSiFrame.src = "pages/myprofile.html";
        hideLoader(500);
    }

    else if (purpose == 'empty') {
        MMSiFrame.src = "pages/splash.html";
        hideLoader(500);
    }

    else if (purpose == 'jobtimesheets') {
         // This was in your menu but missing from your snippet. Assuming standard page:
         MMSiFrame.src = "pages/jobtimesheets.html";
         hideLoader(500);
    }
    
    else if (purpose == 'publicsite') {
        hideLoader(1);
        // Special case: Write HTML directly to iframe for image display
        // Note: Writing raw HTML to src isn't standard, better to load a page or set content
        // But keeping your logic:
        MMSiFrame.src = "about:blank";
        setTimeout(() => {
            MMSiFrame.contentDocument.write('<img id="splashImage" src="https://images.squarespace-cdn.com/content/v1/5ae8afd73917ee3150d25ec8/a9dc2415-e7d7-4e32-b6dc-9f810d0edbb7/image-asset.jpeg" style="width:100%">');
        }, 100);
    }

    else if (purpose == 'clock-in') {
        if (checkRole("Hoobastank")) {                
            const options = { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 };
            if (navigator.geolocation) {
                hideLoader(3000);
                // Call the helper function below
                navigator.geolocation.getCurrentPosition(successLocation, errorLocation, options);
            } else {
                alert("Geolocation is not supported by this browser.");
                hideLoader(100);
            }
        } else {
            MMSiFrame.src = "pages/needmoreprivileges.html";
            hideLoader(500);
        }
    }

    // Scroll top
    window.scrollTo({ top: 0, left: 0, behavior: 'smooth' });
    
    // Mobile: Close menu
    closeMobileMenu();
};

// 4. Helper Functions
function checkRole(role) {
    // Safety check if userRole isn't loaded yet
    return window.userRole && window.userRole.includes(role);
}

function hideLoader(ms) {
    if ($.LoadingOverlay) {
        setTimeout(function() { $.LoadingOverlay("hide"); }, ms);
    }
}

function closeMobileMenu() {
    if ($(".navbar-toggle").is(":visible") && $(".navbar-collapse").hasClass("in")) {
        $(".navbar-toggle").click();
    }
}

function handleLogout() {
    window.sdk.logout();
    localStorage.removeItem("DSR");
    window.location.href = "login.html";
}

// 5. Geolocation Helpers (You need these for Clock-In to work!)
function successLocation(pos) {
    const crd = pos.coords;
    console.log('Your current position is:');
    console.log(`Latitude : ${crd.latitude}`);
    console.log(`Longitude: ${crd.longitude}`);
    
    // Redirect to the Zoho Clock-In form WITH coordinates
    // I am assuming a standard Zoho URL pattern here. 
    // You might need to update this URL to your specific Clock In Form.
    const baseUrl = "https://creatorapp.zohopublic.com/information152/household-goods-moving-services/form-embed/Clock_In/ODk...??"; 
    
    // If you don't have the specific URL handy, we just load the page:
    const iframe = document.getElementById("contentFrame");
    // iframe.src = `pages/clock-in.html?lat=${crd.latitude}&lon=${crd.longitude}`; 
    // Reverting to basic behavior until you provide the Clock-In URL logic:
    alert(`Clock In Location Found: ${crd.latitude}, ${crd.longitude}. \n(Update app.js with the real Zoho URL)`);
}

function errorLocation(err) {
    console.warn(`ERROR(${err.code}): ${err.message}`);
    alert("Could not get location. Clock-in failed.");
}

// Run Startup
document.addEventListener("DOMContentLoaded", initApp);
