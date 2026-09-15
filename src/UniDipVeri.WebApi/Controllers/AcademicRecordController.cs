using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using UniDipVeri.Application.Features.AcademicRecords.Abstractions;
using UniDipVeri.Application.Features.AcademicRecords.Models;
using UniDipVeri.Application.Features.Auth.Abstractions;
using UniDipVeri.Domain.Enums;

namespace UniDipVeri.WebApi.Controllers;

[ApiController]
[Route("api/academic-records")]
public class AcademicRecordController(
    IAuthService authService,
    IAcademicRecordService academicRecordService) : ControllerBase
{
    private readonly IAuthService _authService = authService;
    private readonly IAcademicRecordService _academicRecordService = academicRecordService;

    /// Imports an academic record. Currently, only users with the REGISTRAR role are authorized.
    /// SIS integration is not yet supported and will be addressed for future work.
    [HttpPost("import")]
    [Authorize(Roles = "REGISTRAR")]
    public async Task<IActionResult> ImportRecord(
        [FromBody] ImportAcademicRecordRequest? request,
        CancellationToken ct = default)
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

        var result = await _academicRecordService.ImportRecordAsync(request, ct);
        if (!result.IsSuccess || result.Data is null)
        {
            return MapErrorResult(result.ErrorType, result.Error);
        }

        if (result.Data.IsNewStudent)
        {
            return CreatedAtAction(
                nameof(GetRecordByStudentId),
                new { studentId = result.Data.StudentId },
                result.Data);
        }

        return Ok(result.Data);
    }

    [HttpGet("/api/students/{studentId:guid}/academic-record")]
    [Authorize]
    public async Task<IActionResult> GetRecordByStudentId(
        Guid studentId,
        CancellationToken ct = default)
    {
        if (User.Identity is null || !User.Identity.IsAuthenticated)
        {
            return Unauthorized(new { message = "Not authenticated." });
        }

        var isRegistrar = _authService.RequireRole(User, StaffRole.REGISTRAR);
        if (!isRegistrar)
        {
            var isStudent = User.IsInRole("STUDENT") ||
                            string.Equals(User.FindFirstValue("user_type"), "STUDENT", StringComparison.OrdinalIgnoreCase);

            if (isStudent)
            {
                var currentUserId = User.FindFirstValue(ClaimTypes.NameIdentifier);
                if (!string.Equals(currentUserId, studentId.ToString(), StringComparison.OrdinalIgnoreCase))
                {
                    return StatusCode(StatusCodes.Status403Forbidden, new
                    {
                        message = "Forbidden. Students may only access their own academic record."
                    });
                }
            }
            else
            {
                return StatusCode(StatusCodes.Status403Forbidden, new
                {
                    message = "Forbidden. Access restricted to REGISTRAR or the student themselves."
                });
            }
        }

        var result = await _academicRecordService.GetRecordByStudentIdAsync(studentId, ct);
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

    private IActionResult MapErrorResult(AcademicRecordErrorType errorType, string? error)
    {
        var message = error ?? "An error occurred.";
        return errorType switch
        {
            AcademicRecordErrorType.NotFound => NotFound(new { message }),
            AcademicRecordErrorType.Conflict => Conflict(new { message }),
            AcademicRecordErrorType.Validation => BadRequest(new { message }),
            _ => BadRequest(new { message })
        };
    }
}
