using UniDipVeri.Domain.Common;
using UniDipVeri.Domain.Enums;

namespace UniDipVeri.Domain.Entities;

public class University : BaseEntity
{
    public string Name { get; private set; } = string.Empty;
    public string Code { get; private set; } = string.Empty;
    public string IssuerId { get; private set; } = string.Empty;
    public UniversityStatus Status { get; private set; } = UniversityStatus.ACTIVE;

    public ICollection<UniversityStaff> StaffMembers { get; private set; } = [];
    public ICollection<Program> Programs { get; private set; } = [];

    protected University() { }

    public static University Create(
        string name,
        string code,
        string issuerId,
        UniversityStatus status = UniversityStatus.ACTIVE,
        Guid? id = null)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(name);
        ArgumentException.ThrowIfNullOrWhiteSpace(code);
        ArgumentException.ThrowIfNullOrWhiteSpace(issuerId);

        var university = new University
        {
            Name = name.Trim(),
            Code = code.Trim().ToUpperInvariant(),
            IssuerId = issuerId.Trim(),
            Status = status,
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow
        };

        if (id.HasValue && id.Value != Guid.Empty)
        {
            university.Id = id.Value;
        }

        return university;
    }

    public bool IsActive() => Status == UniversityStatus.ACTIVE;

    public void UpdateDetails(string name, string code, string issuerId)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(name);
        ArgumentException.ThrowIfNullOrWhiteSpace(code);
        ArgumentException.ThrowIfNullOrWhiteSpace(issuerId);

        Name = name.Trim();
        Code = code.Trim().ToUpperInvariant();
        IssuerId = issuerId.Trim();
        UpdatedAt = DateTime.UtcNow;
    }

    public void Deactivate()
    {
        Status = UniversityStatus.INACTIVE;
        UpdatedAt = DateTime.UtcNow;
    }

    public void Activate()
    {
        Status = UniversityStatus.ACTIVE;
        UpdatedAt = DateTime.UtcNow;
    }
}
