using System.Security.Claims;
using FluentAssertions;
using Moq;
using UniDipVeri.Application.Abstractions.Models;
using UniDipVeri.Application.Abstractions.Repositories;
using UniDipVeri.Application.Abstractions.Security;
using UniDipVeri.Application.Features.Auth.Services;
using UniDipVeri.Domain.Entities;
using UniDipVeri.Domain.Enums;

namespace UniDipVeri.UnitTests.Services;

public class AuthServiceTests
{
    private readonly Mock<IStaffRepository> _staffRepoMock = new();
    private readonly Mock<IStudentRepository> _studentRepoMock = new();
    private readonly Mock<IPasswordHasher> _hasherMock = new();
    private readonly Mock<ISessionIssuer> _issuerMock = new();
    private readonly AuthService _authService;
    private readonly Guid _universityId = Guid.NewGuid();
    private readonly Guid _programId = Guid.NewGuid();

    public AuthServiceTests()
    {
        _authService = new AuthService(
            _staffRepoMock.Object,
            _studentRepoMock.Object,
            _hasherMock.Object,
            _issuerMock.Object);
    }

    #region Authentication Tests (FR-AUTH-01-04)

    [Theory]
    [InlineData(StaffRole.REGISTRAR, "REGISTRAR")]
    [InlineData(StaffRole.APPROVER, "APPROVER")]
    [InlineData(StaffRole.ADMIN, "ADMIN")]
    public async Task AuthenticateStaffAsync_ShouldReturnSuccess_ForAllStaffRoles_WhenCredentialsAreValid(
        StaffRole role,
        string expectedRoleClaim)
    {
        // Arrange
        var staffId = Guid.NewGuid();
        var email = $"{role.ToString().ToLower()}@test.com";
        var staff = UniversityStaff.Create(
            _universityId,
            $"{role} Staff",
            email,
            "hashed_pass",
            role,
            id: staffId);

        _staffRepoMock.Setup(r => r.GetByEmailAsync(email, It.IsAny<CancellationToken>()))
            .ReturnsAsync(staff);
        _hasherMock.Setup(h => h.VerifyPassword("password123", "hashed_pass"))
            .Returns(true);
        _issuerMock.Setup(i => i.IssueStaffSession(staffId, expectedRoleClaim))
            .Returns(new SessionToken($"jwt-token-{expectedRoleClaim.ToLower()}", DateTime.UtcNow.AddHours(1)));

        // Act
        var result = await _authService.AuthenticateStaffAsync(email, "password123");

        // Assert
        result.IsSuccess.Should().BeTrue();
        result.Token.Should().NotBeNull();
        result.Token!.Value.Should().Be($"jwt-token-{expectedRoleClaim.ToLower()}");
        _issuerMock.Verify(i => i.IssueStaffSession(staffId, expectedRoleClaim), Times.Once);
    }

    [Fact]
    public async Task AuthenticateStaffAsync_ShouldFail_WhenStaffIsInactive_AndCreateNoSession()
    {
        // Arrange
        var staff = UniversityStaff.Create(
            _universityId,
            "Staff Member",
            "inactive@test.com",
            "hashed_pass",
            StaffRole.REGISTRAR);
        staff.Deactivate();

        _staffRepoMock.Setup(r => r.GetByEmailAsync("inactive@test.com", It.IsAny<CancellationToken>()))
            .ReturnsAsync(staff);

        // Act
        var result = await _authService.AuthenticateStaffAsync("inactive@test.com", "password123");

        // Assert
        result.IsSuccess.Should().BeFalse();
        result.Token.Should().BeNull();
        result.Error.Should().Be("Invalid email or password.");
        _issuerMock.Verify(i => i.IssueStaffSession(It.IsAny<Guid>(), It.IsAny<string>()), Times.Never);
    }

    [Fact]
    public async Task AuthenticateStaffAsync_ShouldFail_WhenPasswordMismatch_AndCreateNoSession()
    {
        // Arrange
        var staff = UniversityStaff.Create(
            _universityId,
            "Staff Member",
            "staff@test.com",
            "hashed_pass",
            StaffRole.ADMIN);

        _staffRepoMock.Setup(r => r.GetByEmailAsync("staff@test.com", It.IsAny<CancellationToken>()))
            .ReturnsAsync(staff);
        _hasherMock.Setup(h => h.VerifyPassword("wrongpass", "hashed_pass"))
            .Returns(false);

        // Act
        var result = await _authService.AuthenticateStaffAsync("staff@test.com", "wrongpass");

        // Assert
        result.IsSuccess.Should().BeFalse();
        result.Token.Should().BeNull();
        result.Error.Should().Be("Invalid email or password.");
        _issuerMock.Verify(i => i.IssueStaffSession(It.IsAny<Guid>(), It.IsAny<string>()), Times.Never);
    }

    [Theory]
    [InlineData("", "pass")]
    [InlineData("   ", "pass")]
    [InlineData("staff@test.com", "")]
    [InlineData("staff@test.com", "   ")]
    public async Task AuthenticateStaffAsync_ShouldFail_WhenCredentialsAreEmpty_AndCreateNoSession(string email, string password)
    {
        // Act
        var result = await _authService.AuthenticateStaffAsync(email, password);

        // Assert
        result.IsSuccess.Should().BeFalse();
        result.Token.Should().BeNull();
        result.Error.Should().Be("Invalid email or password.");
        _issuerMock.Verify(i => i.IssueStaffSession(It.IsAny<Guid>(), It.IsAny<string>()), Times.Never);
    }

    [Fact]
    public async Task AuthenticateAsync_ShouldReturnSuccess_WhenStudentCredentialsAreValid_AndAccountIsActive()
    {
        // Arrange
        var studentId = Guid.NewGuid();
        var student = Student.Create(
            _programId,
            "STD123",
            "Student Name",
            "student@test.com",
            "REF123",
            "hashed_pass",
            id: studentId);
        student.ActivateAccount();

        _studentRepoMock.Setup(r => r.GetByEmailAsync("student@test.com", It.IsAny<CancellationToken>()))
            .ReturnsAsync(student);
        _hasherMock.Setup(h => h.VerifyPassword("studentpass", "hashed_pass"))
            .Returns(true);
        _issuerMock.Setup(i => i.IssueStudentSession(studentId, "STD123"))
            .Returns(new SessionToken("jwt-token-student", DateTime.UtcNow.AddHours(1)));

        // Act
        var result = await _authService.AuthenticateStudentAsync("student@test.com", "studentpass");

        // Assert
        result.IsSuccess.Should().BeTrue();
        result.Token.Should().NotBeNull();
        result.Token!.Value.Should().Be("jwt-token-student");
    }

    [Fact]
    public async Task AuthenticateAsync_ShouldFail_WhenStudentAccountIsPendingActivation()
    {
        // Arrange
        var student = Student.Create(
            _programId,
            "STD123",
            "Student Name",
            "student@test.com",
            "REF123",
            "hashed_pass");

        _studentRepoMock.Setup(r => r.GetByEmailAsync("student@test.com", It.IsAny<CancellationToken>()))
            .ReturnsAsync(student);

        // Act
        var result = await _authService.AuthenticateStudentAsync("student@test.com", "studentpass");

        // Assert
        result.IsSuccess.Should().BeFalse();
        result.Error.Should().Be("Invalid email or password.");
    }

    [Fact]
    public async Task AuthenticateAsync_ShouldFail_WhenStudentAccountIsInactive()
    {
        // Arrange
        var student = Student.Create(
            _programId,
            "STD123",
            "Student Name",
            "student@test.com",
            "REF123",
            "hashed_pass");
        student.DeactivateAccount();

        _studentRepoMock.Setup(r => r.GetByEmailAsync("student@test.com", It.IsAny<CancellationToken>()))
            .ReturnsAsync(student);

        // Act
        var result = await _authService.AuthenticateStudentAsync("student@test.com", "studentpass");

        // Assert
        result.IsSuccess.Should().BeFalse();
        result.Error.Should().Be("Invalid email or password.");
    }

    [Fact]
    public async Task AuthenticateAsync_ShouldFail_WhenUserNotFound()
    {
        // Arrange
        _staffRepoMock.Setup(r => r.GetByEmailAsync("unknown@test.com", It.IsAny<CancellationToken>()))
            .ReturnsAsync((UniversityStaff?)null);
        _studentRepoMock.Setup(r => r.GetByEmailAsync("unknown@test.com", It.IsAny<CancellationToken>()))
            .ReturnsAsync((Student?)null);

        // Act
        var result = await _authService.AuthenticateStaffAsync("unknown@test.com", "pass");

        // Assert
        result.IsSuccess.Should().BeFalse();
        result.Error.Should().Be("Invalid email or password.");
        _issuerMock.Verify(i => i.IssueStaffSession(It.IsAny<Guid>(), It.IsAny<string>()), Times.Never);

        // Act
        result = await _authService.AuthenticateStudentAsync("unknown@test.com", "pass");

        // Assert
        result.IsSuccess.Should().BeFalse();
        result.Error.Should().Be("Invalid email or password.");
    }

    #endregion

    #region RequireRole Tests (FR-AUTH-04, UC-01, US-A3)

    [Theory]
    [InlineData(StaffRole.REGISTRAR, StaffRole.REGISTRAR, true)]
    [InlineData(StaffRole.APPROVER, StaffRole.APPROVER, true)]
    [InlineData(StaffRole.ADMIN, StaffRole.ADMIN, true)]
    [InlineData(StaffRole.REGISTRAR, StaffRole.APPROVER, false)]
    [InlineData(StaffRole.APPROVER, StaffRole.REGISTRAR, false)]
    [InlineData(StaffRole.ADMIN, StaffRole.APPROVER, false)]
    public void RequireRole_ClaimsPrincipal_ShouldValidateRoleCorrectly(
        StaffRole userRole,
        StaffRole requiredRole,
        bool expectedResult)
    {
        // Arrange
        var claims = new[]
        {
            new Claim(ClaimTypes.NameIdentifier, Guid.NewGuid().ToString()),
            new Claim(ClaimTypes.Role, userRole.ToString()),
            new Claim("user_type", "staff")
        };
        var identity = new ClaimsIdentity(claims, "TestAuth");
        var principal = new ClaimsPrincipal(identity);

        // Act
        var result = _authService.RequireRole(principal, requiredRole);

        // Assert
        result.Should().Be(expectedResult);
    }

    [Fact]
    public void RequireRole_ClaimsPrincipal_ShouldReturnFalse_WhenPrincipalIsStudent()
    {
        // Arrange: Student has no staff role
        var claims = new[]
        {
            new Claim(ClaimTypes.NameIdentifier, Guid.NewGuid().ToString()),
            new Claim("user_type", "student")
        };
        var identity = new ClaimsIdentity(claims, "TestAuth");
        var principal = new ClaimsPrincipal(identity);

        // Act & Assert
        _authService.RequireRole(principal, StaffRole.REGISTRAR).Should().BeFalse();
        _authService.RequireRole(principal, StaffRole.APPROVER).Should().BeFalse();
    }

    [Fact]
    public void RequireRole_ClaimsPrincipal_ShouldReturnFalse_WhenPrincipalIsNull()
    {
        _authService.RequireRole((ClaimsPrincipal?)null, StaffRole.REGISTRAR).Should().BeFalse();
    }

    [Fact]
    public void RequireRole_ClaimsPrincipal_ShouldReturnFalse_WhenPrincipalIsUnauthenticated()
    {
        var principal = new ClaimsPrincipal(new ClaimsIdentity()); // unauthenticated

        _authService.RequireRole(principal, StaffRole.REGISTRAR).Should().BeFalse();
    }

    [Fact]
    public void RequireRole_ClaimsPrincipal_ShouldReturnTrue_WhenUserMatchesOneOfMultipleAllowedRoles()
    {
        // Arrange: Approver user
        var claims = new[]
        {
            new Claim(ClaimTypes.NameIdentifier, Guid.NewGuid().ToString()),
            new Claim(ClaimTypes.Role, "APPROVER"),
            new Claim("user_type", "staff")
        };
        var identity = new ClaimsIdentity(claims, "TestAuth");
        var principal = new ClaimsPrincipal(identity);

        // Act & Assert: Should match when APPROVER is among allowed roles
        _authService.RequireRole(principal, StaffRole.REGISTRAR, StaffRole.APPROVER).Should().BeTrue();
        _authService.RequireRole(principal, StaffRole.REGISTRAR, StaffRole.ADMIN).Should().BeFalse();
    }

    [Fact]
    public void RequireRole_SessionToken_ShouldReturnTrue_WhenTokenIsValidAndRoleMatches()
    {
        // Arrange
        var tokenValue = "valid-approver-token";
        var session = new SessionToken(tokenValue, DateTime.UtcNow.AddHours(1));

        var claims = new[]
        {
            new Claim(ClaimTypes.NameIdentifier, Guid.NewGuid().ToString()),
            new Claim(ClaimTypes.Role, "APPROVER"),
            new Claim("user_type", "staff")
        };
        var principal = new ClaimsPrincipal(new ClaimsIdentity(claims, "TestAuth"));

        _issuerMock.Setup(i => i.ValidateToken(tokenValue))
            .Returns(principal);

        // Act & Assert
        _authService.RequireRole(session, StaffRole.APPROVER).Should().BeTrue();
        _authService.RequireRole(session, StaffRole.REGISTRAR).Should().BeFalse();
    }

    [Fact]
    public void RequireRole_SessionToken_ShouldReturnFalse_WhenTokenIsInvalidOrNull()
    {
        _issuerMock.Setup(i => i.ValidateToken("invalid-token"))
            .Returns((ClaimsPrincipal?)null);

        _authService.RequireRole(new SessionToken("invalid-token", DateTime.UtcNow), StaffRole.APPROVER).Should().BeFalse();
        _authService.RequireRole((SessionToken?)null, StaffRole.APPROVER).Should().BeFalse();
        _authService.RequireRole((string?)null, StaffRole.APPROVER).Should().BeFalse();
    }

    [Fact]
    public void RequireRole_ShouldReject_GivenLoggedInRegistrarAttemptingApproverAction_EvenThoughSessionIsValid()
    {
        // Arrange: Given a logged-in Registrar with a valid authenticated session (FR-AUTH-04, UC-01, US-A3)
        var registrarToken = "valid-registrar-jwt";
        var session = new SessionToken(registrarToken, DateTime.UtcNow.AddHours(1));

        var claims = new[]
        {
            new Claim(ClaimTypes.NameIdentifier, Guid.NewGuid().ToString()),
            new Claim(ClaimTypes.Role, StaffRole.REGISTRAR.ToString()),
            new Claim("user_type", "staff")
        };
        var principal = new ClaimsPrincipal(new ClaimsIdentity(claims, "TestAuth"));

        _issuerMock.Setup(i => i.ValidateToken(registrarToken))
            .Returns(principal);

        // Act & Assert: When attempting an Approver-only action, the system rejects it even though the session is valid
        _authService.RequireRole(session, StaffRole.APPROVER).Should().BeFalse();
        _authService.RequireRole(principal, StaffRole.APPROVER).Should().BeFalse();

        // But allows Registrar-permitted action
        _authService.RequireRole(session, StaffRole.REGISTRAR).Should().BeTrue();
        _authService.RequireRole(principal, StaffRole.REGISTRAR).Should().BeTrue();
    }

    [Fact]
    public void RequireRole_ShouldReject_GivenLoggedInApproverAttemptingRegistrarAction_EvenThoughSessionIsValid()
    {
        // Arrange: Given a logged-in Approver with a valid authenticated session
        var approverToken = "valid-approver-jwt";
        var session = new SessionToken(approverToken, DateTime.UtcNow.AddHours(1));

        var claims = new[]
        {
            new Claim(ClaimTypes.NameIdentifier, Guid.NewGuid().ToString()),
            new Claim(ClaimTypes.Role, StaffRole.APPROVER.ToString()),
            new Claim("user_type", "staff")
        };
        var principal = new ClaimsPrincipal(new ClaimsIdentity(claims, "TestAuth"));

        _issuerMock.Setup(i => i.ValidateToken(approverToken))
            .Returns(principal);

        // Act & Assert: When attempting a Registrar-only action, the system rejects it
        _authService.RequireRole(session, StaffRole.REGISTRAR).Should().BeFalse();
        _authService.RequireRole(principal, StaffRole.REGISTRAR).Should().BeFalse();

        // But allows Approver-permitted action
        _authService.RequireRole(session, StaffRole.APPROVER).Should().BeTrue();
        _authService.RequireRole(principal, StaffRole.APPROVER).Should().BeTrue();
    }

    #endregion
}
