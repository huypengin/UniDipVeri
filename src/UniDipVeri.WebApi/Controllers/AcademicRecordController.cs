using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using UniDipVeri.Application.Features.AcademicRecords.Abstractions;
using UniDipVeri.Application.Features.AcademicRecords.Models;
using UniDipVeri.WebApi.Authorization;

namespace UniDipVeri.WebApi.Controllers;

[ApiController]
[Route("api/academic-records")]
public class AcademicRecordController(
    IAcademicRecordService academicRecordService,
    IAuthorizationService authorizationService) : ApiControllerBase
{
    private readonly IAcademicRecordService _academicRecordService = academicRecordService;
    private readonly IAuthorizationService _authorizationService = authorizationService;

    // Imports an academic record. Currently, only users with the REGISTRAR role are authorized.
    // SIS integration is not yet supported and will be addressed for future work.
    [HttpPost("import")]
    [Authorize(Roles = "REGISTRAR")]
    public async Task<IActionResult> ImportRecord(
        [FromBody] ImportAcademicRecordRequest? request,
        CancellationToken ct = default)
    {
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
        var authResult = await _authorizationService.AuthorizeAsync(
            User,
            studentId,
            AuthorizationPolicies.SameStudentOrRegistrar);

        if (!authResult.Succeeded)
        {
            return StatusCode(StatusCodes.Status403Forbidden, new
            {
                message = "Forbidden. Access restricted to REGISTRAR or the student themselves."
            });
        }

        var result = await _academicRecordService.GetRecordByStudentIdAsync(studentId, ct);
        if (!result.IsSuccess || result.Data is null)
        {
            return MapErrorResult(result.ErrorType, result.Error);
        }

        return Ok(result.Data);
    }
}
