using UniDipVeri.Application.Abstractions.Models;

namespace UniDipVeri.Application.Abstractions.Services;

public interface IAuthService
{
    Task<AuthResult> AuthenticateAsync(string email, string password, CancellationToken ct = default);
}