using System.Security.Claims;
using UniDipVeri.Application.Abstractions.Models;

namespace UniDipVeri.Application.Abstractions.Security;

public interface ISessionIssuer
{
    SessionToken IssueStaffSession(Guid staffId, string role);
    SessionToken IssueStudentSession(Guid studentId, string studentNumber);
    ClaimsPrincipal? ValidateToken(string token);
}