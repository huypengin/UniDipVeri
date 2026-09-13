using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using UniDipVeri.Application.Features.Auth.Abstractions;
using UniDipVeri.Application.Features.Programs.Abstractions;
using UniDipVeri.Application.Features.Programs.Models;
using UniDipVeri.Domain.Enums;

namespace UniDipVeri.WebApi.Controllers;

[ApiController]
[Route("api/programs")]
public class ProgramController(IAuthService authService, IProgramService programService) : ControllerBase
{
    private readonly IAuthService _authService = authService;
    private readonly IProgramService _programService = programService;

    [HttpPost]
    [Authorize(Roles = "REGISTRAR")]
    public async Task<IActionResult> CreateProgram([FromBody] CreateProgramRequest? request, CancellationToken ct = default)
    {
        var authCheck = CheckRegistrarAuthorization();
        if (authCheck is not null)
        {
            return authCheck;
        }

        if (request is null)
        {
            return BadRequest(new { message = "Request body is required." });
        }

        var result = await _programService.CreateProgramAsync(request, ct);
        if (!result.IsSuccess || result.Data is null)
        {
            return MapErrorResult(result.ErrorType, result.Error);
        }

        return CreatedAtAction(nameof(GetProgramById), new { id = result.Data.Id }, result.Data);
    }

    [HttpGet]
    [Authorize(Roles = "REGISTRAR")]
    public async Task<IActionResult> ListPrograms(CancellationToken ct = default)
    {
        var authCheck = CheckRegistrarAuthorization();
        if (authCheck is not null)
        {
            return authCheck;
        }

        var result = await _programService.ListProgramsAsync(ct);
        return Ok(result.Data);
    }

    [HttpGet("{id:guid}")]
    [Authorize(Roles = "REGISTRAR")]
    public async Task<IActionResult> GetProgramById(Guid id, CancellationToken ct = default)
    {
        var authCheck = CheckRegistrarAuthorization();
        if (authCheck is not null)
        {
            return authCheck;
        }

        var result = await _programService.GetProgramByIdAsync(id, ct);
        if (!result.IsSuccess || result.Data is null)
        {
            return NotFound(new { message = result.Error ?? "Program not found." });
        }

        return Ok(result.Data);
    }

    [HttpPatch("{id:guid}")]
    [Authorize(Roles = "REGISTRAR")]
    public async Task<IActionResult> UpdateProgram(Guid id, [FromBody] UpdateProgramRequest? request, CancellationToken ct = default)
    {
        var authCheck = CheckRegistrarAuthorization();
        if (authCheck is not null)
        {
            return authCheck;
        }

        if (request is null)
        {
            return BadRequest(new { message = "Request body is required." });
        }

        var result = await _programService.UpdateProgramAsync(id, request, ct);
        if (!result.IsSuccess || result.Data is null)
        {
            return MapErrorResult(result.ErrorType, result.Error);
        }

        return Ok(result.Data);
    }

    private IActionResult? CheckRegistrarAuthorization()
    {
        if (User.Identity is null || !User.Identity.IsAuthenticated)
        {
            return Unauthorized(new { message = "Not authenticated." });
        }

        if (!_authService.RequireRole(User, StaffRole.REGISTRAR))
        {
            return StatusCode(StatusCodes.Status403Forbidden, new { message = "Forbidden. REGISTRAR role required." });
        }

        return null;
    }

    private IActionResult MapErrorResult(ProgramErrorType errorType, string? error)
    {
        var message = error ?? "An error occurred.";
        return errorType switch
        {
            ProgramErrorType.NotFound => NotFound(new { message }),
            ProgramErrorType.Conflict => Conflict(new { message }),
            ProgramErrorType.Validation => BadRequest(new { message }),
            _ => BadRequest(new { message })
        };
    }
}
