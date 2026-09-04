using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using UniDipVeri.Domain.Entities;
using UniDipVeri.Domain.Enums;

namespace UniDipVeri.Infrastructure.Persistence.Configurations;

public class StudentConfiguration : IEntityTypeConfiguration<Student>
{
    public void Configure(EntityTypeBuilder<Student> builder)
    {
        builder.ToTable("students");

        builder.HasKey(s => s.Id);
        builder.Property(s => s.Id).HasColumnName("id");

        builder.Property(s => s.ProgramId)
            .HasColumnName("program_id")
            .IsRequired();

        builder.Property(s => s.StudentNumber)
            .HasColumnName("student_number")
            .HasMaxLength(100)
            .IsRequired();

        builder.HasIndex(s => s.StudentNumber)
            .IsUnique();

        builder.Property(s => s.Name)
            .HasColumnName("name")
            .HasMaxLength(255)
            .IsRequired();

        builder.Property(s => s.Email)
            .HasColumnName("email")
            .HasMaxLength(255)
            .IsRequired();

        builder.HasIndex(s => s.Email)
            .IsUnique();

        builder.Property(s => s.PasswordHash)
            .HasColumnName("password_hash")
            .HasMaxLength(255)
            .IsRequired();

        builder.Property(s => s.AccountStatus)
            .HasColumnName("account_status")
            .HasMaxLength(50)
            .HasConversion<string>()
            .HasDefaultValue(StudentAccountStatus.PENDING_ACTIVATION)
            .IsRequired();

        builder.Property(s => s.GraduationStatus)
            .HasColumnName("graduation_status")
            .HasMaxLength(50)
            .HasConversion<string>()
            .HasDefaultValue(GraduationStatus.NOT_STARTED)
            .IsRequired();

        builder.Property(s => s.SourceRecordRef)
            .HasColumnName("source_record_ref")
            .HasMaxLength(255)
            .IsRequired();

        builder.Property(s => s.WalletId)
            .HasColumnName("wallet_id")
            .HasMaxLength(255)
            .IsRequired(false);

        builder.Property(s => s.WalletStatus)
            .HasColumnName("wallet_status")
            .HasMaxLength(50)
            .HasConversion<string>()
            .IsRequired();

        builder.Property(s => s.ImportedAt)
            .HasColumnName("imported_at")
            .IsRequired();

        builder.Property(s => s.UpdatedAt)
            .HasColumnName("updated_at")
            .IsRequired();

        builder.HasOne(s => s.Program)
            .WithMany(p => p.Students)
            .HasForeignKey(s => s.ProgramId)
            .OnDelete(DeleteBehavior.Restrict);
    }
}
