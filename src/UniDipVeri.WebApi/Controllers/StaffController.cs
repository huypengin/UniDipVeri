using System.Security.Claims;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Mvc;
using UniDipVeri.Application.Abstractions.Services;
using UniDipVeri.Application.Features.Auth.Models;

namespace UniDipVeri.WebApi.Controllers;

[ApiController]
[Route("api/staffs")]
public class StaffController(IAuthService authService) : ControllerBase
{
    private readonly IAuthService _authService = authService;

    [HttpPost("login")]
    public async Task<IActionResult> Login([FromBody] LoginRequest? request, CancellationToken ct = default)
    {
        if (request is null)
        {
            return Unauthorized(new { message = "Invalid email or password." });
        }

        if (!request.TryValidate(out var error))
        {
            return Unauthorized(new { message = error });
        }

        var result = await _authService.AuthenticateStaffAsync(request.Email, request.Password, ct);
        if (!result.IsSuccess || result.User is null)
        {
            return Unauthorized(new { message = result.Error ?? "Invalid email or password." });
        }

        var claims = new List<Claim>
        {
            new(ClaimTypes.NameIdentifier, result.User.Id.ToString()),
            new(ClaimTypes.Email, result.User.Email),
            new(ClaimTypes.Role, result.User.Role),
            new("user_type", result.User.UserType)
        };

        var identity = new ClaimsIdentity(claims, CookieAuthenticationDefaults.AuthenticationScheme);
        var principal = new ClaimsPrincipal(identity);
        var authProperties = new AuthenticationProperties
        {
            IsPersistent = true,
            ExpiresUtc = DateTimeOffset.UtcNow.AddHours(24)
        };

        await HttpContext.SignInAsync(CookieAuthenticationDefaults.AuthenticationScheme, principal, authProperties);

        return Ok(result.User);
    }
}
