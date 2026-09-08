using Microsoft.EntityFrameworkCore;
using UniDipVeri.Application.Abstractions.Repositories;
using UniDipVeri.Domain.Entities;
using UniDipVeri.Domain.Enums;

namespace UniDipVeri.Infrastructure.Persistence.Repositories;

public class PostgresStaffRepository(UniDipVeriDbContext dbContext) : IStaffRepository
{
    private readonly UniDipVeriDbContext _dbContext = dbContext;

    public async Task<UniversityStaff?> GetByIdAsync(Guid id, CancellationToken ct = default)
    {
        return await _dbContext.UniversityStaff
            .Include(s => s.University)
            .Include(s => s.StaffRoles)
            .FirstOrDefaultAsync(s => s.Id == id, ct);
    }

    public async Task<UniversityStaff?> GetByEmailAsync(string email, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(email))
        {
            return null;
        }

        var normalizedEmail = email.Trim().ToLower();
        return await _dbContext.UniversityStaff
            .Include(s => s.University)
            .Include(s => s.StaffRoles)
            .FirstOrDefaultAsync(s => s.Email.ToLower() == normalizedEmail, ct);
    }

    public async Task<int> CountActiveAdminsAsync(CancellationToken ct = default)
    {
        return await _dbContext.UniversityStaff
            .CountAsync(s => s.Status == StaffStatus.ACTIVE && s.StaffRoles.Any(r => r.Role == StaffRole.ADMIN), ct);
    }

    public async Task<IReadOnlyList<UniversityStaff>> ListAllAsync(CancellationToken ct = default)
    {
        return await _dbContext.UniversityStaff
            .Include(s => s.University)
            .Include(s => s.StaffRoles)
            .AsNoTracking()
            .OrderBy(s => s.Name)
            .ToListAsync(ct);
    }

    public async Task<Guid> GetDefaultUniversityIdAsync(CancellationToken ct = default)
    {
        var id = await _dbContext.Universities.Select(u => u.Id).FirstOrDefaultAsync(ct);
        return id != Guid.Empty ? id : ModelBuilderExtensions.UniversityId;
    }

    public async Task AddAsync(UniversityStaff staff, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(staff);
        await _dbContext.UniversityStaff.AddAsync(staff, ct);
        await _dbContext.SaveChangesAsync(ct);
    }

    public async Task UpdateAsync(UniversityStaff staff, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(staff);
        _dbContext.UniversityStaff.Update(staff);
        await _dbContext.SaveChangesAsync(ct);
    }
}
