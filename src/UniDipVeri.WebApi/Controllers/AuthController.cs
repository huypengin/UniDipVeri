using System.Security.Claims;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using UniDipVeri.Application.Features.Auth.Abstractions;
using UniDipVeri.Application.Features.Auth.Models;

namespace UniDipVeri.WebApi.Controllers;

[ApiController]
[Route("api/auth")]
public class AuthController(IAuthService authService) : ControllerBase
{
    private readonly IAuthService _authService = authService;

    [HttpGet("me")]
    [HttpGet("/api/me")]
    public async Task<IActionResult> GetCurrentUser(CancellationToken ct = default)
    {
        if (User.Identity is null || !User.Identity.IsAuthenticated)
        {
            return Unauthorized(new { message = "Not authenticated." });
        }

        var idStr = User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
        var email = User.FindFirst(ClaimTypes.Email)?.Value;
        var nameClaim = User.FindFirst(ClaimTypes.Name)?.Value;
        var role = User.FindFirst(ClaimTypes.Role)?.Value;
        var userType = User.FindFirst("user_type")?.Value ?? "student";
        var studentNumber = User.FindFirst("student_id")?.Value;

        if (Guid.TryParse(idStr, out var userId))
        {
            var profile = await _authService.GetUserProfileAsync(userId, userType, ct);
            if (profile is not null)
            {
                return Ok(new
                {
                    id = profile.Id,
                    email = profile.Email,
                    name = profile.Name,
                    role = profile.Role,
                    roles = profile.Roles,
                    userType = profile.UserType,
                    studentNumber = profile.StudentNumber,
                    institution = profile.Institution
                });
            }
        }

        return Ok(new
        {
            id = idStr,
            email,
            name = !string.IsNullOrWhiteSpace(nameClaim) ? nameClaim : (email ?? string.Empty),
            role,
            roles = role != null ? [role] : Array.Empty<string>(),
            userType,
            studentNumber,
            institution = "Mekong International University"
        });
    }

    [HttpPost("reset-password")]
    public async Task<IActionResult> RequestPasswordReset(
        [FromBody] ResetPasswordRequest? request,
        CancellationToken ct = default)
    {
        if (request is not null && !string.IsNullOrWhiteSpace(request.Email))
        {
            await _authService.RequestPasswordResetAsync(request.Email, ct);
        }

        // Anti-enumeration: always return 200 OK with identical message
        return Ok(new
        {
            message = "If this email is registered, a reset link has been sent."
        });
    }

    [HttpPost("reset-password/confirm")]
    public async Task<IActionResult> ConfirmPasswordReset(
        [FromBody] ConfirmResetPasswordRequest? request,
        CancellationToken ct = default)
    {
        if (request is null || string.IsNullOrWhiteSpace(request.Token) || string.IsNullOrWhiteSpace(request.NewPassword))
        {
            return BadRequest(new { message = "Token and new password are required." });
        }

        var (success, error) = await _authService.ConfirmPasswordResetAsync(request.Token, request.NewPassword, ct);
        if (!success)
        {
            return BadRequest(new { message = error ?? "Failed to reset password." });
        }

        return Ok(new
        {
            message = "Password has been reset successfully."
        });
    }

    [Authorize]
    [HttpPost("change-password")]
    public async Task<IActionResult> ChangePassword(
        [FromBody] ChangePasswordRequest? request,
        CancellationToken ct = default)
    {
        if (request is null || string.IsNullOrWhiteSpace(request.CurrentPassword) || string.IsNullOrWhiteSpace(request.NewPassword))
        {
            return BadRequest(new { message = "Current password and new password are required." });
        }

        var userIdStr = User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
        var userType = User.FindFirst("user_type")?.Value;

        if (string.IsNullOrEmpty(userIdStr) || string.IsNullOrEmpty(userType) || !Guid.TryParse(userIdStr, out var userId))
        {
            return Unauthorized(new { message = "Not authenticated." });
        }

        var (success, error, newSecurityStamp) = await _authService.ChangePasswordAsync(
            userId,
            userType,
            request.CurrentPassword,
            request.NewPassword,
            ct);

        if (!success)
        {
            return BadRequest(new { message = error ?? "Failed to change password." });
        }

        // Rotate current session cookie with new security stamp claim so current device stays active
        var existingClaims = User.Claims.Where(c => c.Type != "security_stamp").ToList();
        if (!string.IsNullOrEmpty(newSecurityStamp))
        {
            existingClaims.Add(new Claim("security_stamp", newSecurityStamp));
        }

        var identity = new ClaimsIdentity(existingClaims, CookieAuthenticationDefaults.AuthenticationScheme);
        var principal = new ClaimsPrincipal(identity);
        var authProperties = new AuthenticationProperties
        {
            IsPersistent = true,
            ExpiresUtc = DateTimeOffset.UtcNow.AddHours(24)
        };

        await HttpContext.SignInAsync(CookieAuthenticationDefaults.AuthenticationScheme, principal, authProperties);

        return Ok(new
        {
            message = "Password changed successfully."
        });
    }

    [HttpPost("logout")]
    public async Task<IActionResult> Logout()
    {
        await HttpContext.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
        return Ok(new { message = "Logged out successfully" });
    }
}
