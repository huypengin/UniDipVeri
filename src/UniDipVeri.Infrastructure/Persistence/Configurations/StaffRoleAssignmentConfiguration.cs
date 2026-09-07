using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using UniDipVeri.Domain.Entities;

namespace UniDipVeri.Infrastructure.Persistence.Configurations;

public class StaffRoleAssignmentConfiguration : IEntityTypeConfiguration<StaffRoleAssignment>
{
    public void Configure(EntityTypeBuilder<StaffRoleAssignment> builder)
    {
        builder.ToTable("staff_role");

        builder.HasKey(r => new { r.StaffId, r.Role });

        builder.Property(r => r.StaffId)
            .HasColumnName("staff_id")
            .IsRequired();

        builder.Property(r => r.Role)
            .HasColumnName("role")
            .HasMaxLength(50)
            .HasConversion<string>()
            .IsRequired();

        builder.HasOne(r => r.Staff)
            .WithMany(s => s.StaffRoles)
            .HasForeignKey(r => r.StaffId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}
