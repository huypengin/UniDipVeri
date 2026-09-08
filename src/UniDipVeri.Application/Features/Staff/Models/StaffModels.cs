using UniDipVeri.Domain.Entities;

namespace UniDipVeri.Application.Features.Staff.Models;

public sealed record StaffResponse
{
    public Guid Id { get; init; }
    public Guid StaffId => Id;
    public string Name { get; init; } = string.Empty;
    public string Email { get; init; } = string.Empty;
    public IReadOnlyList<string> Roles { get; init; } = [];
    public string Status { get; init; } = string.Empty;
    public DateTime CreatedAt { get; init; }
    public DateTime UpdatedAt { get; init; }

    public static StaffResponse FromEntity(UniversityStaff staff)
    {
        return new StaffResponse
        {
            Id = staff.Id,
            Name = staff.Name,
            Email = staff.Email,
            Roles = staff.Roles.Select(r => r.ToString()).ToList(),
            Status = staff.Status.ToString(),
            CreatedAt = staff.CreatedAt,
            UpdatedAt = staff.UpdatedAt
        };
    }
}

public sealed record CreateStaffRequest
{
    public string Name { get; init; } = string.Empty;
    public string Email { get; init; } = string.Empty;
    public string Password { get; init; } = string.Empty;
    public IReadOnlyList<string> Roles { get; init; } = [];
}

public sealed record UpdateStaffRequest
{
    public string? Name { get; init; }
    public string? Email { get; init; }
    public IReadOnlyList<string>? Roles { get; init; }
}

public enum StaffErrorType
{
    None,
    NotFound,
    Conflict,
    Validation,
    PolicyViolation
}

public sealed record StaffResult<T>(
    bool IsSuccess,
    T? Data = default,
    string? Error = null,
    StaffErrorType ErrorType = StaffErrorType.None)
{
    public static StaffResult<T> Success(T data) =>
        new(true, Data: data);

    public static StaffResult<T> NotFound(string error) =>
        new(false, Error: error, ErrorType: StaffErrorType.NotFound);

    public static StaffResult<T> Conflict(string error) =>
        new(false, Error: error, ErrorType: StaffErrorType.Conflict);

    public static StaffResult<T> Validation(string error) =>
        new(false, Error: error, ErrorType: StaffErrorType.Validation);

    public static StaffResult<T> PolicyViolation(string error) =>
        new(false, Error: error, ErrorType: StaffErrorType.PolicyViolation);
}
