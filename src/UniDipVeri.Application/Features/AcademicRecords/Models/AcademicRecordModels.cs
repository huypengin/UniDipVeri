using UniDipVeri.Domain.Entities;

namespace UniDipVeri.Application.Features.AcademicRecords.Models;

public enum AcademicRecordErrorType
{
    None,
    NotFound,
    Conflict,
    Validation
}

public sealed record AcademicRecordResult<T>(
    bool IsSuccess,
    T? Data = default,
    string? Error = null,
    AcademicRecordErrorType ErrorType = AcademicRecordErrorType.None)
{
    public static AcademicRecordResult<T> Success(T data) =>
        new(true, Data: data);

    public static AcademicRecordResult<T> NotFound(string error) =>
        new(false, Error: error, ErrorType: AcademicRecordErrorType.NotFound);

    public static AcademicRecordResult<T> Conflict(string error) =>
        new(false, Error: error, ErrorType: AcademicRecordErrorType.Conflict);

    public static AcademicRecordResult<T> Validation(string error) =>
        new(false, Error: error, ErrorType: AcademicRecordErrorType.Validation);
}

public sealed record ImportAcademicRecordRequest
{
    public string StudentNumber { get; init; } = string.Empty;
    public string Name { get; init; } = string.Empty;
    public string Email { get; init; } = string.Empty;
    public Guid ProgramId { get; init; }
    public int? CreditsCompleted { get; init; }
    public int? Credits { get; init; }
    public decimal Gpa { get; init; }
    public List<string>? CompletedCourses { get; init; }
    public string SourceRecordRef { get; init; } = string.Empty;
    public DateTime? SourceSnapshotAt { get; init; }

    public int GetEffectiveCredits() => CreditsCompleted ?? Credits ?? -1;
}

public sealed record AcademicRecordResponse
{
    public Guid Id { get; init; }
    public Guid StudentId { get; init; }
    public int CreditsCompleted { get; init; }
    public decimal Gpa { get; init; }
    public List<string> CompletedCourses { get; init; } = [];
    public DateTime SourceSnapshotAt { get; init; }
    public DateTime ImportedAt { get; init; }

    public static AcademicRecordResponse FromEntity(AcademicRecord record)
    {
        return new AcademicRecordResponse
        {
            Id = record.Id,
            StudentId = record.StudentId,
            CreditsCompleted = record.CreditsCompleted,
            Gpa = record.Gpa,
            CompletedCourses = new List<string>(record.CompletedCourses),
            SourceSnapshotAt = record.SourceSnapshotAt,
            ImportedAt = record.ImportedAt
        };
    }
}

public sealed record ImportResultResponse
{
    public Guid StudentId { get; init; }
    public string StudentNumber { get; init; } = string.Empty;
    public string Name { get; init; } = string.Empty;
    public string Email { get; init; } = string.Empty;
    public string AccountStatus { get; init; } = string.Empty;
    public string WalletStatus { get; init; } = string.Empty;
    public bool IsNewStudent { get; init; }
    public AcademicRecordResponse AcademicRecord { get; init; } = null!;
}
