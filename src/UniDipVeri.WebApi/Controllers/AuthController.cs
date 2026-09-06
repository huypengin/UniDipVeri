using System.Security.Claims;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Mvc;

namespace UniDipVeri.WebApi.Controllers;

[ApiController]
[Route("api/auth")]
public class AuthController : ControllerBase
{
    [HttpGet("me")]
    public IActionResult GetCurrentUser()
    {
        if (User.Identity is null || !User.Identity.IsAuthenticated)
        {
            return Unauthorized(new { message = "Not authenticated." });
        }

        var id = User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
        var email = User.FindFirst(ClaimTypes.Email)?.Value;
        var role = User.FindFirst(ClaimTypes.Role)?.Value;
        var userType = User.FindFirst("user_type")?.Value;
        var studentNumber = User.FindFirst("student_id")?.Value;

        return Ok(new
        {
            id,
            email,
            role,
            roles = role != null ? [role] : Array.Empty<string>(),
            userType,
            studentNumber
        });
    }

    [HttpPost("logout")]
    public async Task<IActionResult> Logout()
    {
        await HttpContext.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
        return Ok(new { message = "Logged out successfully" });
    }
}
