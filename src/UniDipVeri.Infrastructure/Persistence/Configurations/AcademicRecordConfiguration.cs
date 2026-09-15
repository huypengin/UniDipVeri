using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.ChangeTracking;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using UniDipVeri.Domain.Entities;

namespace UniDipVeri.Infrastructure.Persistence.Configurations;

public class AcademicRecordConfiguration : IEntityTypeConfiguration<AcademicRecord>
{
    public void Configure(EntityTypeBuilder<AcademicRecord> builder)
    {
        builder.ToTable("academic_records");

        builder.HasKey(ar => ar.Id);
        builder.Property(ar => ar.Id).HasColumnName("id");

        builder.Property(ar => ar.StudentId)
            .HasColumnName("student_id")
            .IsRequired();

        builder.HasIndex(ar => ar.StudentId)
            .IsUnique();

        builder.Property(ar => ar.CreditsCompleted)
            .HasColumnName("credits_completed")
            .IsRequired();

        builder.Property(ar => ar.Gpa)
            .HasColumnName("gpa")
            .HasColumnType("numeric(4,2)")
            .IsRequired();

        var listComparer = new ValueComparer<List<string>>(
            (c1, c2) => (c1 == null && c2 == null) || (c1 != null && c2 != null && c1.SequenceEqual(c2)),
            c => c.Aggregate(0, (a, v) => HashCode.Combine(a, v.GetHashCode())),
            c => c.ToList());

        builder.Property(ar => ar.CompletedCourses)
            .HasColumnName("completed_courses")
            .HasColumnType("jsonb")
            .HasConversion(
                v => JsonSerializer.Serialize(v, (JsonSerializerOptions?)null),
                v => JsonSerializer.Deserialize<List<string>>(v, (JsonSerializerOptions?)null) ?? new List<string>(),
                listComparer)
            .IsRequired();

        builder.Property(ar => ar.SourceSnapshotAt)
            .HasColumnName("source_snapshot_at")
            .IsRequired();

        builder.Property(ar => ar.ImportedAt)
            .HasColumnName("imported_at")
            .IsRequired();

        builder.Property(ar => ar.CreatedAt)
            .HasColumnName("created_at")
            .IsRequired();

        builder.Property(ar => ar.UpdatedAt)
            .HasColumnName("updated_at")
            .IsRequired();

        builder.HasOne(ar => ar.Student)
            .WithOne(s => s.AcademicRecord)
            .HasForeignKey<AcademicRecord>(ar => ar.StudentId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}
