using System.Security.Claims;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Mvc;
using UniDipVeri.Application.Features.Auth.Abstractions;
using UniDipVeri.Application.Features.Auth.Models;

namespace UniDipVeri.WebApi.Controllers;

[ApiController]
[Route("api/students")]
public class StudentController(IAuthService authService) : ControllerBase
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

        var result = await _authService.AuthenticateStudentAsync(request.Email, request.Password, ct);
        if (!result.IsSuccess || result.User is null)
        {
            return Unauthorized(new { message = result.Error ?? "Invalid email or password." });
        }

        var claims = new List<Claim>
        {
            new(ClaimTypes.NameIdentifier, result.User.Id.ToString()),
            new(ClaimTypes.Email, result.User.Email),
            new(ClaimTypes.Name, result.User.Name),
            new(ClaimTypes.Role, result.User.Role),
            new("user_type", result.User.UserType),
            new("security_stamp", result.User.SecurityStamp)
        };
        if (!string.IsNullOrEmpty(result.User.StudentNumber))
        {
            claims.Add(new Claim("student_id", result.User.StudentNumber));
        }

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
