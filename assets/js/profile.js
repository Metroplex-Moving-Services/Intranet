/* =======================================================
   profile.js
   Handles populating the user data on the My Profile page
   by reading from the parent window's session.
   ======================================================= */

$(document).ready(function() {
    try {
        // Access the 'user' variable from index.html (parent window)
        var parentUser = window.parent.user;
        
        if (parentUser && parentUser.data) {
            var data = parentUser.data;
            
            // 1. POPULATE TEXT FIELDS
            $("#dispName").text(data.name || "Team Member");
            $("#dispEmail").text(data.email || "No Email on File");
            $("#dispPhone").text(data.phone || "No Phone on File");
            $("#dispRole").text(data.roleNames ? data.roleNames.join(", ") : "Standard User");
            $("#dispId").text(data.userId || "Unknown");

            // 2. PROFILE PICTURE LOGIC
            // If a picture URL exists in the data...
            if (data.picture) {
                // Replace the default icon with the actual image
                $("#avatarContainer").html(
                    `<img src="${data.picture}" alt="Profile" style="width:100%; height:100%; border-radius:50%; object-fit:cover;">`
                );
                // Make the background transparent so the photo looks clean
                $("#avatarContainer").css("background-color", "transparent");
            } 
            
        } else {
            $("#dispName").text("Session Error");
            $(".detail-value").text("Please re-login");
        }
    } catch (e) {
        console.error("Could not load user data from parent:", e);
        $("#dispName").text("Data Error");
    }
});
