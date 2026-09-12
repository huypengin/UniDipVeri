using UniDipVeri.Application.Features.Programs.Models;

namespace UniDipVeri.Application.Features.Programs.Abstractions;

public interface IProgramService
{
    Task<ProgramResult<ProgramResponse>> CreateProgramAsync(CreateProgramRequest request, CancellationToken ct = default);
    Task<ProgramResult<IReadOnlyList<ProgramResponse>>> ListProgramsAsync(CancellationToken ct = default);
    Task<ProgramResult<ProgramResponse>> GetProgramByIdAsync(Guid id, CancellationToken ct = default);
    Task<ProgramResult<ProgramResponse>> UpdateProgramAsync(Guid id, UpdateProgramRequest request, CancellationToken ct = default);
}
