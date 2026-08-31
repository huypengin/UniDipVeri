using UniDipVeri.Domain.Common;
using UniDipVeri.Domain.Enums;

namespace UniDipVeri.Domain.Entities;

public class Student : BaseEntity
{
    public Guid ProgramId { get; private set; }
    public string StudentNumber { get; private set; } = string.Empty;
    public string Name { get; private set; } = string.Empty;
    public string Email { get; private set; } = string.Empty;
    public string PasswordHash { get; private set; } = string.Empty;
    public StudentAccountStatus AccountStatus { get; private set; } = StudentAccountStatus.PENDING_ACTIVATION;
    public GraduationStatus GraduationStatus { get; private set; } = GraduationStatus.NOT_STARTED;
    public string SourceRecordRef { get; private set; } = string.Empty;
    public string? WalletId { get; private set; }
    public WalletStatus WalletStatus { get; private set; } = WalletStatus.PENDING;
    public DateTime ImportedAt { get; private set; } = DateTime.UtcNow;

    public Program? Program { get; private set; }

    protected Student() { }

    public static Student Create(
        Guid programId,
        string studentNumber,
        string name,
        string email,
        string sourceRecordRef,
        string? passwordHash = null,
        Guid? id = null)
    {
        if (programId == Guid.Empty)
        {
            throw new ArgumentException("ProgramId cannot be empty.", nameof(programId));
        }

        ArgumentException.ThrowIfNullOrWhiteSpace(studentNumber);
        ArgumentException.ThrowIfNullOrWhiteSpace(name);
        ArgumentException.ThrowIfNullOrWhiteSpace(email);
        ArgumentException.ThrowIfNullOrWhiteSpace(sourceRecordRef);

        var now = DateTime.UtcNow;
        var student = new Student
        {
            ProgramId = programId,
            StudentNumber = studentNumber.Trim(),
            Name = name.Trim(),
            Email = email.Trim().ToLowerInvariant(),
            PasswordHash = passwordHash ?? string.Empty,
            SourceRecordRef = sourceRecordRef.Trim(),
            AccountStatus = StudentAccountStatus.PENDING_ACTIVATION,
            GraduationStatus = GraduationStatus.NOT_STARTED,
            WalletStatus = WalletStatus.PENDING,
            ImportedAt = now,
            CreatedAt = now,
            UpdatedAt = now
        };

        if (id.HasValue && id.Value != Guid.Empty)
        {
            student.Id = id.Value;
        }

        return student;
    }

    public bool IsWalletReady() => WalletStatus == WalletStatus.ACTIVE && !string.IsNullOrEmpty(WalletId);

    public bool IsAccountActive() => AccountStatus == StudentAccountStatus.ACTIVE;

    public void ActivateAccount()
    {
        AccountStatus = StudentAccountStatus.ACTIVE;
        UpdatedAt = DateTime.UtcNow;
    }

    public void DeactivateAccount()
    {
        AccountStatus = StudentAccountStatus.INACTIVE;
        if (WalletStatus == WalletStatus.ACTIVE)
        {
            WalletStatus = WalletStatus.INACTIVE;
        }
        UpdatedAt = DateTime.UtcNow;
    }

    public void DeactivateWallet()
    {
        WalletStatus = WalletStatus.INACTIVE;
        UpdatedAt = DateTime.UtcNow;
    }

    public void UpdateGraduationStatus(GraduationStatus newStatus)
    {
        GraduationStatus = newStatus;
        UpdatedAt = DateTime.UtcNow;
    }

    public void AssignWallet(string walletId)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(walletId);
        WalletId = walletId.Trim();
        WalletStatus = WalletStatus.ACTIVE;
        UpdatedAt = DateTime.UtcNow;
    }

    public void MarkWalletFailed()
    {
        WalletStatus = WalletStatus.FAILED;
        UpdatedAt = DateTime.UtcNow;
    }

    public void SetWalletPending()
    {
        WalletStatus = WalletStatus.PENDING;
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
