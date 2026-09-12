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
        if (request is null)
        {
            return ProgramResult<ProgramResponse>.Validation("Request body is required.");
        }

        if (string.IsNullOrWhiteSpace(request.Name))
        {
            return ProgramResult<ProgramResponse>.Validation("Program name is required.");
        }

        if (string.IsNullOrWhiteSpace(request.FullTitle))
        {
            return ProgramResult<ProgramResponse>.Validation("Program full title is required.");
        }

        if (!Enum.TryParse<DegreeLevel>(request.DegreeLevel, ignoreCase: true, out var degreeLevel) || !Enum.IsDefined(degreeLevel))
        {
            return ProgramResult<ProgramResponse>.Validation(
                $"Invalid degree level '{request.DegreeLevel}'. Valid levels are: {string.Join(", ", Enum.GetNames<DegreeLevel>())}.");
        }

        try
        {
            Program.ValidateDegreeLevelKeyword(request.FullTitle, degreeLevel);
        }
        catch (ArgumentException ex)
        {
            return ProgramResult<ProgramResponse>.Validation(ex.Message);
        }

        var universityId = await _programRepository.GetDefaultUniversityIdAsync(ct);

        if (await _programRepository.ExistsByNameAsync(universityId, request.Name, ct: ct))
        {
            return ProgramResult<ProgramResponse>.Conflict($"A program with the name '{request.Name}' already exists.");
        }

        var program = Program.Create(
            universityId,
            request.Name,
            request.FullTitle,
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

        if (request is null)
        {
            return ProgramResult<ProgramResponse>.Validation("Request body is required.");
        }

        var program = await _programRepository.GetByIdAsync(id, ct);
        if (program is null)
        {
            return ProgramResult<ProgramResponse>.NotFound("Program not found.");
        }

        var newName = request.Name is not null ? request.Name.Trim() : program.Name;
        if (string.IsNullOrWhiteSpace(newName))
        {
            return ProgramResult<ProgramResponse>.Validation("Program name cannot be empty.");
        }

        if (!string.Equals(newName, program.Name, StringComparison.OrdinalIgnoreCase))
        {
            if (await _programRepository.ExistsByNameAsync(program.UniversityId, newName, excludeId: program.Id, ct: ct))
            {
                return ProgramResult<ProgramResponse>.Conflict($"A program with the name '{newName}' already exists.");
            }
        }

        var newDegreeLevel = program.DegreeLevel;
        if (!string.IsNullOrWhiteSpace(request.DegreeLevel))
        {
            if (!Enum.TryParse<DegreeLevel>(request.DegreeLevel, ignoreCase: true, out newDegreeLevel) || !Enum.IsDefined(newDegreeLevel))
            {
                return ProgramResult<ProgramResponse>.Validation(
                    $"Invalid degree level '{request.DegreeLevel}'. Valid levels are: {string.Join(", ", Enum.GetNames<DegreeLevel>())}.");
            }
        }

        var newFullTitle = request.FullTitle is not null ? request.FullTitle.Trim() : program.FullTitle;
        if (string.IsNullOrWhiteSpace(newFullTitle))
        {
            return ProgramResult<ProgramResponse>.Validation("Program full title cannot be empty.");
        }

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
            if (!Enum.TryParse<ProgramStatus>(request.Status, ignoreCase: true, out var newStatus) || !Enum.IsDefined(newStatus))
            {
                return ProgramResult<ProgramResponse>.Validation(
                    $"Invalid status '{request.Status}'. Valid statuses are: {string.Join(", ", Enum.GetNames<ProgramStatus>())}.");
            }

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
