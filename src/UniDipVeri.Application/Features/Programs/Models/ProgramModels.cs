using UniDipVeri.Domain.Entities;

namespace UniDipVeri.Application.Features.Programs.Models;

public sealed record ProgramResponse
{
    public Guid Id { get; init; }
    public Guid ProgramId => Id;
    public Guid UniversityId { get; init; }
    public string Name { get; init; } = string.Empty;
    public string FullTitle { get; init; } = string.Empty;
    public string DegreeLevel { get; init; } = string.Empty;
    public string Status { get; init; } = string.Empty;
    public DateTime CreatedAt { get; init; }
    public DateTime UpdatedAt { get; init; }

    public static ProgramResponse FromEntity(Program program)
    {
        return new ProgramResponse
        {
            Id = program.Id,
            UniversityId = program.UniversityId,
            Name = program.Name,
            FullTitle = program.FullTitle,
            DegreeLevel = program.DegreeLevel.ToString(),
            Status = program.Status.ToString(),
            CreatedAt = program.CreatedAt,
            UpdatedAt = program.UpdatedAt
        };
    }
}

public sealed record CreateProgramRequest
{
    public string Name { get; init; } = string.Empty;
    public string FullTitle { get; init; } = string.Empty;
    public string DegreeLevel { get; init; } = string.Empty;
}

public sealed record UpdateProgramRequest
{
    public string? Name { get; init; }
    public string? FullTitle { get; init; }
    public string? DegreeLevel { get; init; }
    public string? Status { get; init; }
}

public enum ProgramErrorType
{
    None,
    NotFound,
    Conflict,
    Validation
}

public sealed record ProgramResult<T>(
    bool IsSuccess,
    T? Data = default,
    string? Error = null,
    ProgramErrorType ErrorType = ProgramErrorType.None)
{
    public static ProgramResult<T> Success(T data) =>
        new(true, Data: data);

    public static ProgramResult<T> NotFound(string error) =>
        new(false, Error: error, ErrorType: ProgramErrorType.NotFound);

    public static ProgramResult<T> Conflict(string error) =>
        new(false, Error: error, ErrorType: ProgramErrorType.Conflict);

    public static ProgramResult<T> Validation(string error) =>
        new(false, Error: error, ErrorType: ProgramErrorType.Validation);
}
