/* profile.js - Populates My Profile */
$(document).ready(function() {
    try {
        var parentUser = window.parent.user;
        if (parentUser && parentUser.data) {
            var data = parentUser.data;
            $("#dispName").text(data.name || "Team Member");
            $("#dispEmail").text(data.email || "-");
            $("#dispPhone").text(data.phone || "-");
            $("#dispRole").text(data.roleNames ? data.roleNames.join(", ") : "Standard User");
            $("#dispId").text(data.userId || "-");

            if (data.picture) {
                $("#avatarContainer").html(`<img src="${data.picture}" style="width:100%; height:100%; border-radius:50%; object-fit:cover;">`);
                $("#avatarContainer").css("background-color", "transparent");
            } 
        }
    } catch (e) { console.error(e); }
});
