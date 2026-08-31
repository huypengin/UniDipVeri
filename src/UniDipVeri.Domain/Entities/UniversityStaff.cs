using UniDipVeri.Domain.Common;
using UniDipVeri.Domain.Enums;

namespace UniDipVeri.Domain.Entities;

public class UniversityStaff : BaseEntity
{
    public Guid UniversityId { get; private set; }
    public string Name { get; private set; } = string.Empty;
    public string Email { get; private set; } = string.Empty;
    public string PasswordHash { get; private set; } = string.Empty;
    public StaffRole Role { get; private set; }
    public StaffStatus Status { get; private set; } = StaffStatus.ACTIVE;

    public University? University { get; private set; }

    protected UniversityStaff() { }

    public static UniversityStaff Create(
        Guid universityId,
        string name,
        string email,
        string passwordHash,
        StaffRole role,
        Guid? id = null)
    {
        if (universityId == Guid.Empty)
        {
            throw new ArgumentException("UniversityId cannot be empty.", nameof(universityId));
        }

        ArgumentException.ThrowIfNullOrWhiteSpace(name);
        ArgumentException.ThrowIfNullOrWhiteSpace(email);
        ArgumentException.ThrowIfNullOrWhiteSpace(passwordHash);

        var staff = new UniversityStaff
        {
            UniversityId = universityId,
            Name = name.Trim(),
            Email = email.Trim().ToLowerInvariant(),
            PasswordHash = passwordHash,
            Role = role,
            Status = StaffStatus.ACTIVE,
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow
        };

        if (id.HasValue && id.Value != Guid.Empty)
        {
            staff.Id = id.Value;
        }

        return staff;
    }

    public bool IsActive() => Status == StaffStatus.ACTIVE;

    public bool HasRole(StaffRole requiredRole) => Role == requiredRole;

    public void Deactivate()
    {
        Status = StaffStatus.INACTIVE;
        UpdatedAt = DateTime.UtcNow;
    }

    public void Activate()
    {
        Status = StaffStatus.ACTIVE;
        UpdatedAt = DateTime.UtcNow;
    }

    public void UpdateRole(StaffRole newRole)
    {
        Role = newRole;
        UpdatedAt = DateTime.UtcNow;
    }

    public void SetPassword(string passwordHash)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(passwordHash);
        PasswordHash = passwordHash;
        UpdatedAt = DateTime.UtcNow;
    }

    public void UpdateProfile(string name, string email)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(name);
        ArgumentException.ThrowIfNullOrWhiteSpace(email);

        Name = name.Trim();
        Email = email.Trim().ToLowerInvariant();
        UpdatedAt = DateTime.UtcNow;
    }
}
