using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using UniDipVeri.Domain.Entities;
using UniDipVeri.Domain.Enums;

namespace UniDipVeri.Infrastructure.Persistence.Configurations;

public class ProgramConfiguration : IEntityTypeConfiguration<Program>
{
    public void Configure(EntityTypeBuilder<Program> builder)
    {
        builder.ToTable("programs");

        builder.HasKey(p => p.Id);
        builder.Property(p => p.Id).HasColumnName("id");

        builder.Property(p => p.UniversityId)
            .HasColumnName("university_id")
            .IsRequired();

        builder.Property(p => p.Name)
            .HasColumnName("name")
            .HasMaxLength(255)
            .IsRequired();

        builder.Property(p => p.FullTitle)
            .HasColumnName("full_title")
            .HasMaxLength(255)
            .IsRequired();

        builder.Property(p => p.DegreeLevel)
            .HasColumnName("degree_level")
            .HasMaxLength(50)
            .HasConversion<string>()
            .HasDefaultValue(DegreeLevel.BACHELOR)
            .IsRequired();

        builder.Property(p => p.Status)
            .HasColumnName("status")
            .HasMaxLength(50)
            .HasConversion<string>()
            .HasDefaultValue(ProgramStatus.ACTIVE)
            .IsRequired();

        builder.Property(p => p.CreatedAt)
            .HasColumnName("created_at")
            .IsRequired();

        builder.Property(p => p.UpdatedAt)
            .HasColumnName("updated_at")
            .IsRequired();

        builder.HasOne(p => p.University)
            .WithMany(u => u.Programs)
            .HasForeignKey(p => p.UniversityId)
            .OnDelete(DeleteBehavior.Restrict);
    }
}
