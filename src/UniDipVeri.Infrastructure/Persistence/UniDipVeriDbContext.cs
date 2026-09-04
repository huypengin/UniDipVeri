using Microsoft.EntityFrameworkCore;
using UniDipVeri.Domain.Entities;

namespace UniDipVeri.Infrastructure.Persistence;

public class UniDipVeriDbContext(DbContextOptions<UniDipVeriDbContext> options) : DbContext(options)
{
    public DbSet<University> Universities => Set<University>();
    public DbSet<Program> Programs => Set<Program>();
    public DbSet<UniversityStaff> UniversityStaff => Set<UniversityStaff>();
    public DbSet<Student> Students => Set<Student>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);
        modelBuilder.ApplyConfigurationsFromAssembly(typeof(UniDipVeriDbContext).Assembly);
    }
}
