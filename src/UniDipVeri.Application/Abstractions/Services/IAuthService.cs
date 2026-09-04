using UniDipVeri.Application.Abstractions.Models;

namespace UniDipVeri.Application.Abstractions.Services;

public interface IAuthService
{
    Task<AuthResult> AuthenticateStaffAsync(string email, string password, CancellationToken ct = default);
    Task<AuthResult> AuthenticateStudentAsync(string email, string password, CancellationToken ct = default);
}