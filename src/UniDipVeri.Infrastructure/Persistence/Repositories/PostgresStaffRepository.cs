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
            .FirstOrDefaultAsync(s => s.Email.ToLower() == normalizedEmail, ct);
    }

    public async Task<int> CountActiveAdminsAsync(CancellationToken ct = default)
    {
        return await _dbContext.UniversityStaff
            .CountAsync(s => s.Role == StaffRole.ADMIN && s.Status == StaffStatus.ACTIVE, ct);
    }

    public async Task<IReadOnlyList<UniversityStaff>> ListAllAsync(CancellationToken ct = default)
    {
        return await _dbContext.UniversityStaff
            .Include(s => s.University)
            .AsNoTracking()
            .OrderBy(s => s.Name)
            .ToListAsync(ct);
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
