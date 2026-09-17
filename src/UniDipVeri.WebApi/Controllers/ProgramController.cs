using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using UniDipVeri.Application.Features.Programs.Abstractions;
using UniDipVeri.Application.Features.Programs.Models;

namespace UniDipVeri.WebApi.Controllers;

[ApiController]
[Route("api/programs")]
[Authorize(Roles = "REGISTRAR")]
public class ProgramController(IProgramService programService) : ApiControllerBase
{
    private readonly IProgramService _programService = programService;

    [HttpPost]
    public async Task<IActionResult> CreateProgram([FromBody] CreateProgramRequest? request, CancellationToken ct = default)
    {
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
    public async Task<IActionResult> ListPrograms(CancellationToken ct = default)
    {
        var result = await _programService.ListProgramsAsync(ct);
        return Ok(result.Data);
    }

    [HttpGet("{id:guid}")]
    public async Task<IActionResult> GetProgramById(Guid id, CancellationToken ct = default)
    {
        var result = await _programService.GetProgramByIdAsync(id, ct);
        if (!result.IsSuccess || result.Data is null)
        {
            return NotFound(new { message = result.Error ?? "Program not found." });
        }

        return Ok(result.Data);
    }

    [HttpPatch("{id:guid}")]
    public async Task<IActionResult> UpdateProgram(Guid id, [FromBody] UpdateProgramRequest? request, CancellationToken ct = default)
    {
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
}
