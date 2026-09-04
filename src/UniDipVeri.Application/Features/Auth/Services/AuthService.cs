using UniDipVeri.Application.Abstractions.Models;
using UniDipVeri.Application.Abstractions.Repositories;
using UniDipVeri.Application.Abstractions.Security;
using UniDipVeri.Application.Abstractions.Services;

namespace UniDipVeri.Application.Features.Auth.Services;

public sealed class AuthService : IAuthService
{
    private readonly IStaffRepository _staffRepository;
    private readonly IStudentRepository _studentRepository;
    private readonly IPasswordHasher _passwordHasher;
    private readonly ISessionIssuer _sessionIssuer;

    public AuthService(
        IStaffRepository staffRepository,
        IStudentRepository studentRepository,
        IPasswordHasher passwordHasher,
        ISessionIssuer sessionIssuer)
    {
        _staffRepository = staffRepository;
        _studentRepository = studentRepository;
        _passwordHasher = passwordHasher;
        _sessionIssuer = sessionIssuer;
    }

    public async Task<AuthResult> AuthenticateAsync(string email, string password, CancellationToken ct = default)
    {
        // 1. Attempt to authenticate as Staff (includes Admins, Registrars, Approvers)
        var staff = await _staffRepository.GetByEmailAsync(email, ct);
        if (staff is not null)
        {
            if (!staff.IsActive() || !_passwordHasher.VerifyPassword(password, staff.PasswordHash))
            {
                return AuthResult.Failure("Invalid email or password.");
            }

            var token = _sessionIssuer.IssueStaffSession(staff.Id, staff.Role.ToString());
            return AuthResult.Success(token);
        }

        // 2. Attempt to authenticate as Student
        var student = await _studentRepository.GetByEmailAsync(email, ct);
        if (student is not null)
        {
            if (!student.IsAccountActive() || !_passwordHasher.VerifyPassword(password, student.PasswordHash))
            {
                return AuthResult.Failure("Invalid email or password.");
            }

            var token = _sessionIssuer.IssueStudentSession(student.Id, student.StudentNumber);
            return AuthResult.Success(token);
        }

        // 3. User not found (Return generic message to prevent username enumeration)
        return AuthResult.Failure("Invalid email or password.");
    }
}