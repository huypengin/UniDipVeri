using Microsoft.EntityFrameworkCore;
using UniDipVeri.Domain.Entities;
using UniDipVeri.Domain.Enums;

namespace UniDipVeri.Infrastructure.Persistence;

public static class ModelBuilderExtensions
{
    public static readonly Guid UniversityId = Guid.Parse("11111111-1111-1111-1111-111111111111");

    public static readonly Guid ProgramCsId = Guid.Parse("22222222-2222-2222-2222-222222222221");
    public static readonly Guid ProgramSeId = Guid.Parse("22222222-2222-2222-2222-222222222222");

    public static readonly Guid StaffAdminId = Guid.Parse("33333333-3333-3333-3333-333333333331");
    public static readonly Guid StaffRegistrarId = Guid.Parse("33333333-3333-3333-3333-333333333332");
    public static readonly Guid StaffApproverId = Guid.Parse("33333333-3333-3333-3333-333333333333");

    public static readonly Guid StudentAliceId = Guid.Parse("44444444-4444-4444-4444-444444444441");
    public static readonly Guid StudentBobId = Guid.Parse("44444444-4444-4444-4444-444444444442");

    // Standard dev password: Password123! (verified with Pbkdf2PasswordHasher)
    public const string DefaultPasswordHash = "sha256.600000.a7I238/7ec9pD3ZfmSr7yg==.ZqaSsZ2dnjnlRAFRgLq6RTdSmNGycU+DSsdxdmmufk0=";

    public static void SeedDevData(this ModelBuilder modelBuilder)
    {
        var seedTime = new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc);

        // 1. University
        modelBuilder.Entity<University>().HasData(new
        {
            Id = UniversityId,
            Name = "Mekong International University",
            Code = "MIU",
            IssuerId = "did:web:miu.example",
            Status = UniversityStatus.ACTIVE,
            CreatedAt = seedTime,
            UpdatedAt = seedTime
        });

        // 2. Academic Programs
        modelBuilder.Entity<Domain.Entities.Program>().HasData(
            new
            {
                Id = ProgramCsId,
                UniversityId = UniversityId,
                Name = "Computer Science",
                FullTitle = "Bachelor of Science in Computer Science",
                DegreeLevel = DegreeLevel.BACHELOR,
                Status = ProgramStatus.ACTIVE,
                CreatedAt = seedTime,
                UpdatedAt = seedTime
            },
            new
            {
                Id = ProgramSeId,
                UniversityId = UniversityId,
                Name = "Software Engineering",
                FullTitle = "Master of Science in Software Engineering",
                DegreeLevel = DegreeLevel.MASTER,
                Status = ProgramStatus.ACTIVE,
                CreatedAt = seedTime,
                UpdatedAt = seedTime
            }
        );

        // 3. University Staff (Admin, Registrar, Approver)
        modelBuilder.Entity<UniversityStaff>().HasData(
            new
            {
                Id = StaffAdminId,
                UniversityId = UniversityId,
                Name = "System Administrator",
                Email = "admin@staff.miu.example",
                PasswordHash = DefaultPasswordHash,
                Role = StaffRole.ADMIN,
                Status = StaffStatus.ACTIVE,
                CreatedAt = seedTime,
                UpdatedAt = seedTime
            },
            new
            {
                Id = StaffRegistrarId,
                UniversityId = UniversityId,
                Name = "Sarah Registrar",
                Email = "registrar@staff.miu.example",
                PasswordHash = DefaultPasswordHash,
                Role = StaffRole.REGISTRAR,
                Status = StaffStatus.ACTIVE,
                CreatedAt = seedTime,
                UpdatedAt = seedTime
            },
            new
            {
                Id = StaffApproverId,
                UniversityId = UniversityId,
                Name = "David Approver",
                Email = "approver@staff.miu.example",
                PasswordHash = DefaultPasswordHash,
                Role = StaffRole.APPROVER,
                Status = StaffStatus.ACTIVE,
                CreatedAt = seedTime,
                UpdatedAt = seedTime
            }
        );

        // 4. Students
        modelBuilder.Entity<Student>().HasData(
            // Alice Nguyen: Active graduate eligible for diploma
            new
            {
                Id = StudentAliceId,
                ProgramId = ProgramCsId,
                StudentNumber = "STU-2026-001",
                Name = "Alice Nguyen",
                Email = "student@student.miu.example",
                PasswordHash = DefaultPasswordHash,
                AccountStatus = StudentAccountStatus.ACTIVE,
                GraduationStatus = GraduationStatus.ELIGIBLE,
                SourceRecordRef = "SIS-2026-CS-001",
                WalletId = "wallet_stu_001_alice",
                WalletStatus = WalletStatus.ACTIVE,
                ImportedAt = seedTime,
                CreatedAt = seedTime,
                UpdatedAt = seedTime
            },
            // Bob Tran: Pending first-time activation (testing onboarding / password creation)
            new
            {
                Id = StudentBobId,
                ProgramId = ProgramCsId,
                StudentNumber = "STU-2026-002",
                Name = "Bob Tran",
                Email = "bob.tran@student.miu.example",
                PasswordHash = string.Empty,
                AccountStatus = StudentAccountStatus.PENDING_ACTIVATION,
                GraduationStatus = GraduationStatus.NOT_STARTED,
                SourceRecordRef = "SIS-2026-CS-002",
                WalletStatus = WalletStatus.PENDING,
                ImportedAt = seedTime,
                CreatedAt = seedTime,
                UpdatedAt = seedTime
            }
        );
    }
}
