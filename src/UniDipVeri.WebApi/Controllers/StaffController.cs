using Microsoft.AspNetCore.Mvc;
using UniDipVeri.Application.Abstractions.Services;
using UniDipVeri.Application.Features.Auth.Models;

namespace UniDipVeri.WebApi.Controllers;

[ApiController]
[Route("api/staff")]
public class StaffController(IAuthService authService) : ControllerBase
{
    private readonly IAuthService _authService = authService;

    [HttpPost("/api/auth/login")]
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
        if (!result.IsSuccess || result.Token is null)
        {
            return Unauthorized(new { message = result.Error ?? "Invalid email or password." });
        }

        return Ok(result.Token);
    }
}
