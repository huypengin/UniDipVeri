using UniDipVeri.Application.Abstractions.Repositories;
using UniDipVeri.Application.Features.Programs.Abstractions;
using UniDipVeri.Application.Features.Programs.Models;
using UniDipVeri.Domain.Entities;
using UniDipVeri.Domain.Enums;

namespace UniDipVeri.Application.Features.Programs.Services;

public class ProgramService(IProgramRepository programRepository) : IProgramService
{
    private readonly IProgramRepository _programRepository = programRepository;

    public async Task<ProgramResult<ProgramResponse>> CreateProgramAsync(CreateProgramRequest request, CancellationToken ct = default)
    {
        var degreeLevel = Enum.Parse<DegreeLevel>(request.DegreeLevel.Trim(), ignoreCase: true);
        var universityId = await _programRepository.GetDefaultUniversityIdAsync(ct);

        if (await _programRepository.ExistsByNameAsync(universityId, request.Name.Trim(), ct: ct))
        {
            return ProgramResult<ProgramResponse>.Conflict($"A program with the name '{request.Name}' already exists.");
        }

        var program = Program.Create(
            universityId,
            request.Name.Trim(),
            request.FullTitle.Trim(),
            degreeLevel);

        await _programRepository.AddAsync(program, ct);

        return ProgramResult<ProgramResponse>.Success(ProgramResponse.FromEntity(program));
    }

    public async Task<ProgramResult<IReadOnlyList<ProgramResponse>>> ListProgramsAsync(CancellationToken ct = default)
    {
        var programs = await _programRepository.ListAllAsync(ct);
        var response = programs.Select(ProgramResponse.FromEntity).ToList();
        return ProgramResult<IReadOnlyList<ProgramResponse>>.Success(response);
    }

    public async Task<ProgramResult<ProgramResponse>> GetProgramByIdAsync(Guid id, CancellationToken ct = default)
    {
        if (id == Guid.Empty)
        {
            return ProgramResult<ProgramResponse>.NotFound("Program not found.");
        }

        var program = await _programRepository.GetByIdAsync(id, ct);
        if (program is null)
        {
            return ProgramResult<ProgramResponse>.NotFound("Program not found.");
        }

        return ProgramResult<ProgramResponse>.Success(ProgramResponse.FromEntity(program));
    }

    public async Task<ProgramResult<ProgramResponse>> UpdateProgramAsync(Guid id, UpdateProgramRequest request, CancellationToken ct = default)
    {
        if (id == Guid.Empty)
        {
            return ProgramResult<ProgramResponse>.NotFound("Program not found.");
        }

        var program = await _programRepository.GetByIdAsync(id, ct);
        if (program is null)
        {
            return ProgramResult<ProgramResponse>.NotFound("Program not found.");
        }

        var newName = request.Name is not null ? request.Name.Trim() : program.Name;
        if (!string.Equals(newName, program.Name, StringComparison.OrdinalIgnoreCase))
        {
            if (await _programRepository.ExistsByNameAsync(program.UniversityId, newName, excludeId: program.Id, ct: ct))
            {
                return ProgramResult<ProgramResponse>.Conflict($"A program with the name '{newName}' already exists.");
            }
        }

        var newDegreeLevel = !string.IsNullOrWhiteSpace(request.DegreeLevel)
            ? Enum.Parse<DegreeLevel>(request.DegreeLevel.Trim(), ignoreCase: true)
            : program.DegreeLevel;

        var newFullTitle = request.FullTitle is not null ? request.FullTitle.Trim() : program.FullTitle;

        try
        {
            Program.ValidateDegreeLevelKeyword(newFullTitle, newDegreeLevel);
        }
        catch (ArgumentException ex)
        {
            return ProgramResult<ProgramResponse>.Validation(ex.Message);
        }

        program.UpdateDetails(newName, newFullTitle, newDegreeLevel);

        if (!string.IsNullOrWhiteSpace(request.Status))
        {
            var newStatus = Enum.Parse<ProgramStatus>(request.Status.Trim(), ignoreCase: true);

            if (newStatus == ProgramStatus.INACTIVE && program.Status != ProgramStatus.INACTIVE)
            {
                program.Deactivate();
            }
            else if (newStatus == ProgramStatus.ACTIVE && program.Status != ProgramStatus.ACTIVE)
            {
                program.Activate();
            }
        }

        await _programRepository.UpdateAsync(program, ct);

        return ProgramResult<ProgramResponse>.Success(ProgramResponse.FromEntity(program));
    }
}
