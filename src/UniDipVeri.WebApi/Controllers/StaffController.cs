using System.Security.Claims;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using UniDipVeri.Application.Features.Auth.Abstractions;
using UniDipVeri.Application.Features.Auth.Models;
using UniDipVeri.Application.Features.Staff.Abstractions;
using UniDipVeri.Application.Features.Staff.Models;
using UniDipVeri.Domain.Enums;

namespace UniDipVeri.WebApi.Controllers;

[ApiController]
[Route("api/staffs")]
public class StaffController(IAuthService authService, IStaffService staffService) : ControllerBase
{
    private readonly IAuthService _authService = authService;
    private readonly IStaffService _staffService = staffService;

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
            new(ClaimTypes.Name, result.User.Name),
            new("user_type", result.User.UserType),
            new("security_stamp", result.User.SecurityStamp)
        };

        foreach (var role in result.User.Roles)
        {
            claims.Add(new Claim(ClaimTypes.Role, role));
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

    [HttpPost]
    [Authorize(Roles = "ADMIN")]
    public async Task<IActionResult> CreateStaff([FromBody] CreateStaffRequest? request, CancellationToken ct = default)
    {
        var authCheck = CheckAdminAuthorization();
        if (authCheck is not null)
        {
            return authCheck;
        }

        if (request is null)
        {
            return BadRequest(new { message = "Request body is required." });
        }

        var result = await _staffService.CreateStaffAsync(request, ct);
        if (!result.IsSuccess || result.Data is null)
        {
            return MapErrorResult(result.ErrorType, result.Error);
        }

        return CreatedAtAction(nameof(GetStaffById), new { id = result.Data.Id }, result.Data);
    }

    [HttpGet]
    [Authorize(Roles = "ADMIN")]
    public async Task<IActionResult> ListStaff(CancellationToken ct = default)
    {
        var authCheck = CheckAdminAuthorization();
        if (authCheck is not null)
        {
            return authCheck;
        }

        var result = await _staffService.ListStaffAsync(ct);
        return Ok(result.Data);
    }

    [HttpGet("{id:guid}")]
    [Authorize(Roles = "ADMIN")]
    public async Task<IActionResult> GetStaffById(Guid id, CancellationToken ct = default)
    {
        var authCheck = CheckAdminAuthorization();
        if (authCheck is not null)
        {
            return authCheck;
        }

        var result = await _staffService.GetStaffByIdAsync(id, ct);
        if (!result.IsSuccess || result.Data is null)
        {
            return NotFound(new { message = result.Error ?? "Staff member not found." });
        }

        return Ok(result.Data);
    }

    [HttpPatch("{id:guid}")]
    [Authorize(Roles = "ADMIN")]
    public async Task<IActionResult> UpdateStaff(Guid id, [FromBody] UpdateStaffRequest? request, CancellationToken ct = default)
    {
        var authCheck = CheckAdminAuthorization();
        if (authCheck is not null)
        {
            return authCheck;
        }

        if (request is null)
        {
            return BadRequest(new { message = "Request body is required." });
        }

        var result = await _staffService.UpdateStaffAsync(id, request, ct);
        if (!result.IsSuccess || result.Data is null)
        {
            return MapErrorResult(result.ErrorType, result.Error);
        }

        return Ok(result.Data);
    }

    [HttpPost("{id:guid}/deactivate")]
    [Authorize(Roles = "ADMIN")]
    public async Task<IActionResult> DeactivateStaff(Guid id, CancellationToken ct = default)
    {
        var authCheck = CheckAdminAuthorization();
        if (authCheck is not null)
        {
            return authCheck;
        }

        var result = await _staffService.DeactivateStaffAsync(id, ct);
        if (!result.IsSuccess || result.Data is null)
        {
            return MapErrorResult(result.ErrorType, result.Error);
        }

        return Ok(result.Data);
    }

    private IActionResult? CheckAdminAuthorization()
    {
        if (User.Identity is null || !User.Identity.IsAuthenticated)
        {
            return Unauthorized(new { message = "Not authenticated." });
        }

        if (!_authService.RequireRole(User, StaffRole.ADMIN))
        {
            return StatusCode(StatusCodes.Status403Forbidden, new { message = "Forbidden. ADMIN role required." });
        }

        return null;
    }

    private IActionResult MapErrorResult(StaffErrorType errorType, string? error)
    {
        var message = error ?? "An error occurred.";
        return errorType switch
        {
            StaffErrorType.NotFound => NotFound(new { message }),
            StaffErrorType.Conflict => Conflict(new { message }),
            StaffErrorType.PolicyViolation => BadRequest(new { message }),
            _ => BadRequest(new { message })
        };
    }
}
