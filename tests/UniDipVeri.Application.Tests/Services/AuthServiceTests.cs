using System.Security.Claims;
using FluentAssertions;
using Moq;
using UniDipVeri.Application.Abstractions.Communication;
using UniDipVeri.Application.Abstractions.Repositories;
using UniDipVeri.Application.Abstractions.Security;
using UniDipVeri.Application.Features.Auth.Services;
using UniDipVeri.Domain.Entities;
using UniDipVeri.Domain.Enums;

namespace UniDipVeri.Application.Tests.Services;

public class AuthServiceTests
{
    private readonly Mock<IStaffRepository> _staffRepoMock = new();
    private readonly Mock<IStudentRepository> _studentRepoMock = new();
    private readonly Mock<IPasswordResetTokenRepository> _tokenRepoMock = new();
    private readonly Mock<IPasswordHasher> _hasherMock = new();
    private readonly Mock<IEmailSender> _emailSenderMock = new();
    private readonly AuthService _authService;
    private readonly Guid _universityId = Guid.NewGuid();
    private readonly Guid _programId = Guid.NewGuid();

    public AuthServiceTests()
    {
        _authService = new AuthService(
            _staffRepoMock.Object,
            _studentRepoMock.Object,
            _tokenRepoMock.Object,
            _hasherMock.Object,
            _emailSenderMock.Object);
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

        // Act
        var result = await _authService.AuthenticateStaffAsync(email, "password123");

        // Assert
        result.IsSuccess.Should().BeTrue();
        result.User.Should().NotBeNull();
        result.User!.Id.Should().Be(staffId);
        result.User.Email.Should().Be(email);
        result.User.Name.Should().Be($"{role} Staff");
        result.User.Role.Should().Be(expectedRoleClaim);
        result.User.UserType.Should().Be("staff");
    }

    [Fact]
    public async Task AuthenticateStaffAsync_ShouldFail_WhenStaffIsInactive_AndCreateNoSession()
    {
        // Arrange
        var staff = UniversityStaff.Create(
            _universityId,
            "Inactive Staff",
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
        result.Error.Should().Be("Invalid email or password.");
    }

    [Fact]
    public async Task AuthenticateStaffAsync_ShouldFail_WhenPasswordMismatch_AndCreateNoSession()
    {
        // Arrange
        var staff = UniversityStaff.Create(
            _universityId,
            "Active Staff",
            "staff@test.com",
            "hashed_pass",
            StaffRole.REGISTRAR);

        _staffRepoMock.Setup(r => r.GetByEmailAsync("staff@test.com", It.IsAny<CancellationToken>()))
            .ReturnsAsync(staff);
        _hasherMock.Setup(h => h.VerifyPassword("wrongpass", "hashed_pass"))
            .Returns(false);

        // Act
        var result = await _authService.AuthenticateStaffAsync("staff@test.com", "wrongpass");

        // Assert
        result.IsSuccess.Should().BeFalse();
        result.Error.Should().Be("Invalid email or password.");
    }

    [Theory]
    [InlineData("", "password")]
    [InlineData("staff@test.com", "")]
    [InlineData("   ", "   ")]
    public async Task AuthenticateStaffAsync_ShouldFail_WhenCredentialsAreEmpty_AndCreateNoSession(string email, string password)
    {
        // Act
        var result = await _authService.AuthenticateStaffAsync(email, password);

        // Assert
        result.IsSuccess.Should().BeFalse();
        result.Error.Should().Be("Invalid email or password.");
    }

    [Fact]
    public async Task AuthenticateStudentAsync_ShouldReturnSuccess_WhenCredentialsAreValid()
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

        // Act
        var result = await _authService.AuthenticateStudentAsync("student@test.com", "studentpass");

        // Assert
        result.IsSuccess.Should().BeTrue();
        result.User.Should().NotBeNull();
        result.User!.Id.Should().Be(studentId);
        result.User.Email.Should().Be("student@test.com");
        result.User.Name.Should().Be("Student Name");
        result.User.Role.Should().Be("STUDENT");
        result.User.UserType.Should().Be("student");
        result.User.StudentNumber.Should().Be("STD123");
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
    public void RequireRole_ShouldReject_GivenLoggedInRegistrarAttemptingApproverAction_EvenThoughSessionIsValid()
    {
        // Arrange: Given a logged-in Registrar with a valid authenticated session (FR-AUTH-04, UC-01, US-A3)
        var claims = new[]
        {
            new Claim(ClaimTypes.NameIdentifier, Guid.NewGuid().ToString()),
            new Claim(ClaimTypes.Role, StaffRole.REGISTRAR.ToString()),
            new Claim("user_type", "staff")
        };
        var principal = new ClaimsPrincipal(new ClaimsIdentity(claims, "TestAuth"));

        // Act & Assert: When attempting an Approver-only action, the system rejects it even though the session is valid
        _authService.RequireRole(principal, StaffRole.APPROVER).Should().BeFalse();

        // But allows Registrar-permitted action
        _authService.RequireRole(principal, StaffRole.REGISTRAR).Should().BeTrue();
    }

    [Fact]
    public void RequireRole_ShouldReject_GivenLoggedInApproverAttemptingRegistrarAction_EvenThoughSessionIsValid()
    {
        // Arrange: Given a logged-in Approver with a valid authenticated session
        var claims = new[]
        {
            new Claim(ClaimTypes.NameIdentifier, Guid.NewGuid().ToString()),
            new Claim(ClaimTypes.Role, StaffRole.APPROVER.ToString()),
            new Claim("user_type", "staff")
        };
        var principal = new ClaimsPrincipal(new ClaimsIdentity(claims, "TestAuth"));

        // Act & Assert: When attempting a Registrar-only action, the system rejects it
        _authService.RequireRole(principal, StaffRole.REGISTRAR).Should().BeFalse();

        // But allows Approver-permitted action
        _authService.RequireRole(principal, StaffRole.APPROVER).Should().BeTrue();
    }

    #endregion

    #region Password Reset & Account Management Tests (Issue #2)

    [Fact]
    public async Task RequestPasswordResetAsync_ShouldSilentlyReturn_WhenUserDoesNotExist()
    {
        // Arrange
        _staffRepoMock.Setup(r => r.GetByEmailAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((UniversityStaff?)null);
        _studentRepoMock.Setup(r => r.GetByEmailAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((Student?)null);

        // Act
        await _authService.RequestPasswordResetAsync("nonexistent@test.com");

        // Assert: Anti-enumeration ensures no tokens are added and no emails sent
        _tokenRepoMock.Verify(r => r.AddAsync(It.IsAny<PasswordResetToken>(), It.IsAny<CancellationToken>()), Times.Never);
        _emailSenderMock.Verify(s => s.SendPasswordResetEmailAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<string>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task RequestPasswordResetAsync_ShouldCreateTokenAndSendEmail_WhenStaffExists()
    {
        // Arrange
        var staff = UniversityStaff.Create(_universityId, "Test Staff", "staff@test.com", "hash", StaffRole.ADMIN);
        _staffRepoMock.Setup(r => r.GetByEmailAsync("staff@test.com", It.IsAny<CancellationToken>()))
            .ReturnsAsync(staff);

        // Act
        await _authService.RequestPasswordResetAsync("staff@test.com");

        // Assert
        _tokenRepoMock.Verify(r => r.InvalidateExistingTokensForEmailAsync("staff@test.com", It.IsAny<CancellationToken>()), Times.Once);
        _tokenRepoMock.Verify(r => r.AddAsync(It.Is<PasswordResetToken>(t => t.Email == "staff@test.com" && t.UserType == "staff"), It.IsAny<CancellationToken>()), Times.Once);
        _emailSenderMock.Verify(s => s.SendPasswordResetEmailAsync("staff@test.com", "Test Staff", It.IsAny<string>(), It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task RequestPasswordResetAsync_ShouldCreateTokenAndSendEmail_WhenStudentExists()
    {
        // Arrange
        var student = Student.Create(_programId, "STU-001", "Test Student", "student@test.com", "REF-001");
        _studentRepoMock.Setup(r => r.GetByEmailAsync("student@test.com", It.IsAny<CancellationToken>()))
            .ReturnsAsync(student);

        // Act
        await _authService.RequestPasswordResetAsync("student@test.com");

        // Assert
        _tokenRepoMock.Verify(r => r.InvalidateExistingTokensForEmailAsync("student@test.com", It.IsAny<CancellationToken>()), Times.Once);
        _tokenRepoMock.Verify(r => r.AddAsync(It.Is<PasswordResetToken>(t => t.Email == "student@test.com" && t.UserType == "student"), It.IsAny<CancellationToken>()), Times.Once);
        _emailSenderMock.Verify(s => s.SendPasswordResetEmailAsync("student@test.com", "Test Student", It.IsAny<string>(), It.IsAny<CancellationToken>()), Times.Once);
    }

    [Theory]
    [InlineData("short1!")]
    [InlineData("allletters")]
    [InlineData("1234567890")]
    public async Task ConfirmPasswordResetAsync_ShouldFail_WhenPasswordComplexityNotMet(string weakPassword)
    {
        // Act
        var (success, error) = await _authService.ConfirmPasswordResetAsync("anytoken", weakPassword);

        // Assert
        success.Should().BeFalse();
        error.Should().NotBeNullOrWhiteSpace();
    }

    [Fact]
    public async Task ConfirmPasswordResetAsync_ShouldFail_WhenTokenIsInvalidOrExpired()
    {
        // Arrange
        _tokenRepoMock.Setup(r => r.GetValidTokenByHashAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((PasswordResetToken?)null);

        // Act
        var (success, error) = await _authService.ConfirmPasswordResetAsync("invalidtoken", "ValidPassword123!");

        // Assert
        success.Should().BeFalse();
        error.Should().Be("Invalid or expired reset token.");
    }

    [Fact]
    public async Task ConfirmPasswordResetAsync_ShouldUpdateStaffPassword_WhenValidToken()
    {
        // Arrange
        var token = PasswordResetToken.Create("staff@test.com", "staff", "dummyhash", TimeSpan.FromMinutes(15));
        _tokenRepoMock.Setup(r => r.GetValidTokenByHashAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(token);

        var staff = UniversityStaff.Create(_universityId, "Test Staff", "staff@test.com", "oldHash", StaffRole.ADMIN);
        _staffRepoMock.Setup(r => r.GetByEmailAsync("staff@test.com", It.IsAny<CancellationToken>()))
            .ReturnsAsync(staff);
        _hasherMock.Setup(h => h.HashPassword("NewPassword123!")).Returns("newHashedPassword");

        // Act
        var (success, error) = await _authService.ConfirmPasswordResetAsync("anytoken", "NewPassword123!");

        // Assert
        success.Should().BeTrue();
        error.Should().BeNull();
        staff.PasswordHash.Should().Be("newHashedPassword");
        token.UsedAt.Should().NotBeNull();
        _staffRepoMock.Verify(r => r.UpdateAsync(staff, It.IsAny<CancellationToken>()), Times.Once);
        _tokenRepoMock.Verify(r => r.UpdateAsync(token, It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task ConfirmPasswordResetAsync_ShouldActivatePendingStudent_WhenResettingPassword()
    {
        // Arrange
        var token = PasswordResetToken.Create("student@test.com", "student", "dummyhash", TimeSpan.FromMinutes(15));
        _tokenRepoMock.Setup(r => r.GetValidTokenByHashAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(token);

        var student = Student.Create(_programId, "STU-001", "Test Student", "student@test.com", "REF-001");
        student.AccountStatus.Should().Be(StudentAccountStatus.PENDING_ACTIVATION);

        _studentRepoMock.Setup(r => r.GetByEmailAsync("student@test.com", It.IsAny<CancellationToken>()))
            .ReturnsAsync(student);
        _hasherMock.Setup(h => h.HashPassword("NewPassword123!")).Returns("newHashedPassword");

        // Act
        var (success, error) = await _authService.ConfirmPasswordResetAsync("anytoken", "NewPassword123!");

        // Assert
        success.Should().BeTrue();
        error.Should().BeNull();
        student.AccountStatus.Should().Be(StudentAccountStatus.ACTIVE);
        student.PasswordHash.Should().Be("newHashedPassword");
        token.UsedAt.Should().NotBeNull();
        _studentRepoMock.Verify(r => r.UpdateAsync(student, It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task ChangePasswordAsync_ShouldFail_WhenCurrentPasswordIncorrect()
    {
        // Arrange
        var staff = UniversityStaff.Create(_universityId, "Test Staff", "staff@test.com", "oldHash", StaffRole.ADMIN);
        _staffRepoMock.Setup(r => r.GetByIdAsync(staff.Id, It.IsAny<CancellationToken>()))
            .ReturnsAsync(staff);
        _hasherMock.Setup(h => h.VerifyPassword("WrongPassword123!", "oldHash")).Returns(false);

        // Act
        var (success, error, stamp) = await _authService.ChangePasswordAsync(staff.Id, "staff", "WrongPassword123!", "NewPassword123!");

        // Assert
        success.Should().BeFalse();
        error.Should().Be("Current password is incorrect.");
        stamp.Should().BeNull();
    }

    [Fact]
    public async Task ChangePasswordAsync_ShouldSucceedAndRotateStamp_WhenCurrentPasswordCorrect()
    {
        // Arrange
        var staff = UniversityStaff.Create(_universityId, "Test Staff", "staff@test.com", "oldHash", StaffRole.ADMIN);
        var initialStamp = staff.SecurityStamp;
        _staffRepoMock.Setup(r => r.GetByIdAsync(staff.Id, It.IsAny<CancellationToken>()))
            .ReturnsAsync(staff);
        _hasherMock.Setup(h => h.VerifyPassword("CorrectPassword123!", "oldHash")).Returns(true);
        _hasherMock.Setup(h => h.HashPassword("NewPassword123!")).Returns("newHashedPassword");

        // Act
        var (success, error, newStamp) = await _authService.ChangePasswordAsync(staff.Id, "staff", "CorrectPassword123!", "NewPassword123!");

        // Assert
        success.Should().BeTrue();
        error.Should().BeNull();
        newStamp.Should().NotBeNullOrWhiteSpace();
        newStamp.Should().NotBe(initialStamp);
        staff.PasswordHash.Should().Be("newHashedPassword");
        _staffRepoMock.Verify(r => r.UpdateAsync(staff, It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task ValidateSecurityStampAsync_ShouldReturnTrue_WhenStampMatches()
    {
        // Arrange
        var staff = UniversityStaff.Create(_universityId, "Test Staff", "staff@test.com", "hash", StaffRole.ADMIN);
        _staffRepoMock.Setup(r => r.GetByIdAsync(staff.Id, It.IsAny<CancellationToken>()))
            .ReturnsAsync(staff);

        // Act
        var result = await _authService.ValidateSecurityStampAsync(staff.Id, "staff", staff.SecurityStamp);

        // Assert
        result.Should().BeTrue();
    }

    [Fact]
    public async Task ValidateSecurityStampAsync_ShouldReturnFalse_WhenStampMismatched()
    {
        // Arrange
        var staff = UniversityStaff.Create(_universityId, "Test Staff", "staff@test.com", "hash", StaffRole.ADMIN);
        _staffRepoMock.Setup(r => r.GetByIdAsync(staff.Id, It.IsAny<CancellationToken>()))
            .ReturnsAsync(staff);

        // Act
        var result = await _authService.ValidateSecurityStampAsync(staff.Id, "staff", "outdated_stamp_123");

        // Assert
        result.Should().BeFalse();
    }

    [Fact]
    public async Task GetUserProfileAsync_ShouldReturnCompleteProfile_ForStaff()
    {
        // Arrange
        var staff = UniversityStaff.Create(_universityId, "Admin User", "admin@test.com", "hash", StaffRole.ADMIN);
        _staffRepoMock.Setup(r => r.GetByIdAsync(staff.Id, It.IsAny<CancellationToken>()))
            .ReturnsAsync(staff);

        // Act
        var profile = await _authService.GetUserProfileAsync(staff.Id, "staff");

        // Assert
        profile.Should().NotBeNull();
        profile!.Email.Should().Be("admin@test.com");
        profile.Name.Should().Be("Admin User");
        profile.UserType.Should().Be("staff");
        profile.Role.Should().Be("ADMIN");
        profile.Institution.Should().Be("Mekong International University");
    }

    #endregion
}
