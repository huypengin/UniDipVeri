using Microsoft.EntityFrameworkCore;
using UniDipVeri.Application.Abstractions.Repositories;
using UniDipVeri.Domain.Entities;

namespace UniDipVeri.Infrastructure.Persistence.Repositories;

public class PostgresPasswordResetTokenRepository(UniDipVeriDbContext dbContext) : IPasswordResetTokenRepository
{
    private readonly UniDipVeriDbContext _dbContext = dbContext;

    public async Task AddAsync(PasswordResetToken token, CancellationToken ct = default)
    {
        await _dbContext.PasswordResetTokens.AddAsync(token, ct);
        await _dbContext.SaveChangesAsync(ct);
    }

    public async Task<PasswordResetToken?> GetValidTokenByHashAsync(string tokenHash, CancellationToken ct = default)
    {
        var now = DateTime.UtcNow;
        return await _dbContext.PasswordResetTokens
            .Where(t => t.TokenHash == tokenHash && t.UsedAt == null && t.ExpiresAt > now)
            .OrderByDescending(t => t.CreatedAt)
            .FirstOrDefaultAsync(ct);
    }

    public async Task InvalidateExistingTokensForEmailAsync(string email, CancellationToken ct = default)
    {
        var activeTokens = await _dbContext.PasswordResetTokens
            .Where(t => t.Email == email && t.UsedAt == null)
            .ToListAsync(ct);

        if (activeTokens.Count > 0)
        {
            var now = DateTime.UtcNow;
            foreach (var token in activeTokens)
            {
                token.MarkAsUsed(now);
            }
            await _dbContext.SaveChangesAsync(ct);
        }
    }

    public async Task UpdateAsync(PasswordResetToken token, CancellationToken ct = default)
    {
        _dbContext.PasswordResetTokens.Update(token);
        await _dbContext.SaveChangesAsync(ct);
    }
}
