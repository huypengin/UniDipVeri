using UniDipVeri.Domain.Common;
using UniDipVeri.Domain.Enums;

namespace UniDipVeri.Domain.Entities;

public class UniversityStaff : BaseEntity
{
    private readonly List<StaffRoleAssignment> _staffRoles = [];

    public Guid UniversityId { get; private set; }
    public string Name { get; private set; } = string.Empty;
    public string Email { get; private set; } = string.Empty;
    public string PasswordHash { get; private set; } = string.Empty;
    public string SecurityStamp { get; private set; } = Guid.NewGuid().ToString("N");
    public StaffStatus Status { get; private set; } = StaffStatus.ACTIVE;

    public University? University { get; private set; }
    public IReadOnlyCollection<StaffRoleAssignment> StaffRoles => _staffRoles.AsReadOnly();
    public IReadOnlyCollection<StaffRole> Roles => _staffRoles.Select(r => r.Role).Distinct().ToList().AsReadOnly();

    public StaffRole Role => Roles.FirstOrDefault();

    protected UniversityStaff() { }

    public static UniversityStaff Create(
        Guid universityId,
        string name,
        string email,
        string passwordHash,
        IEnumerable<StaffRole> roles,
        Guid? id = null)
    {
        if (universityId == Guid.Empty)
        {
            throw new ArgumentException("UniversityId cannot be empty.", nameof(universityId));
        }

        ArgumentException.ThrowIfNullOrWhiteSpace(name);
        ArgumentException.ThrowIfNullOrWhiteSpace(email);
        ArgumentException.ThrowIfNullOrWhiteSpace(passwordHash);
        ArgumentNullException.ThrowIfNull(roles);

        var rolesList = roles.Distinct().ToList();
        if (rolesList.Count == 0)
        {
            throw new ArgumentException("At least one staff role must be assigned.", nameof(roles));
        }

        var staffId = id.HasValue && id.Value != Guid.Empty ? id.Value : Guid.NewGuid();
        var now = DateTime.UtcNow;

        var staff = new UniversityStaff
        {
            Id = staffId,
            UniversityId = universityId,
            Name = name.Trim(),
            Email = email.Trim().ToLowerInvariant(),
            PasswordHash = passwordHash,
            Status = StaffStatus.ACTIVE,
            CreatedAt = now,
            UpdatedAt = now
        };

        foreach (var role in rolesList)
        {
            staff._staffRoles.Add(new StaffRoleAssignment(staffId, role));
        }

        return staff;
    }

    public static UniversityStaff Create(
        Guid universityId,
        string name,
        string email,
        string passwordHash,
        StaffRole role,
        Guid? id = null)
        => Create(universityId, name, email, passwordHash, [role], id);

    public bool IsActive() => Status == StaffStatus.ACTIVE;

    public bool HasRole(StaffRole requiredRole) => _staffRoles.Any(r => r.Role == requiredRole);

    public void AddRole(StaffRole role)
    {
        if (!HasRole(role))
        {
            _staffRoles.Add(new StaffRoleAssignment(Id, role));
            UpdatedAt = DateTime.UtcNow;
        }
    }

    public void RemoveRole(StaffRole role)
    {
        var existing = _staffRoles.FirstOrDefault(r => r.Role == role);
        if (existing is not null)
        {
            if (_staffRoles.Count <= 1)
            {
                throw new InvalidOperationException("Cannot remove the last remaining role from a staff member.");
            }
            _staffRoles.Remove(existing);
            UpdatedAt = DateTime.UtcNow;
        }
    }

    public void UpdateRoles(IEnumerable<StaffRole> roles)
    {
        ArgumentNullException.ThrowIfNull(roles);
        var rolesList = roles.Distinct().ToList();
        if (rolesList.Count == 0)
        {
            throw new ArgumentException("At least one staff role must be assigned.", nameof(roles));
        }

        _staffRoles.Clear();
        foreach (var role in rolesList)
        {
            _staffRoles.Add(new StaffRoleAssignment(Id, role));
        }
        UpdatedAt = DateTime.UtcNow;
    }

    public void UpdateRole(StaffRole newRole) => UpdateRoles([newRole]);

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

    public void SetPassword(string passwordHash)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(passwordHash);
        PasswordHash = passwordHash;
        RotateSecurityStamp();
    }

    public void RotateSecurityStamp()
    {
        SecurityStamp = Guid.NewGuid().ToString("N");
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
