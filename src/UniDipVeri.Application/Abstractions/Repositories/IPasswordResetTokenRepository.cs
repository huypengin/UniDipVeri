using UniDipVeri.Domain.Entities;

namespace UniDipVeri.Application.Abstractions.Repositories;

public interface IPasswordResetTokenRepository
{
    Task AddAsync(PasswordResetToken token, CancellationToken ct = default);
    Task<PasswordResetToken?> GetValidTokenByHashAsync(string tokenHash, CancellationToken ct = default);
    Task InvalidateExistingTokensForEmailAsync(string email, CancellationToken ct = default);
    Task UpdateAsync(PasswordResetToken token, CancellationToken ct = default);
}
