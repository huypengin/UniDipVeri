using FluentAssertions;
using Microsoft.Extensions.Options;
using Moq;
using UniDipVeri.Application.Abstractions.Repositories;
using UniDipVeri.Application.Abstractions.Security;
using UniDipVeri.Application.Configurations;
using UniDipVeri.Application.Features.Staff.Models;
using UniDipVeri.Application.Features.Staff.Services;
using UniDipVeri.Domain.Entities;
using UniDipVeri.Domain.Enums;

namespace UniDipVeri.Application.Tests.Services;

public class StaffServiceTests
{
    private readonly Mock<IStaffRepository> _staffRepoMock = new();
    private readonly Mock<IPasswordHasher> _hasherMock = new();
    private readonly Guid _universityId = Guid.NewGuid();

    private StaffService CreateService(bool allowRegistrarApproverCombination = false)
    {
        var options = Options.Create(new ApprovalPolicyOptions
        {
            AllowRegistrarApproverCombination = allowRegistrarApproverCombination
        });

        _staffRepoMock.Setup(r => r.GetDefaultUniversityIdAsync(It.IsAny<CancellationToken>()))
            .ReturnsAsync(_universityId);
        _hasherMock.Setup(h => h.HashPassword(It.IsAny<string>()))
            .Returns((string p) => $"hashed_{p}");

        return new StaffService(_staffRepoMock.Object, _hasherMock.Object, options);
    }

    #region CreateStaffAsync Tests

    [Theory]
    [InlineData("ADMIN")]
    [InlineData("REGISTRAR")]
    [InlineData("APPROVER")]
    public async Task CreateStaffAsync_ShouldCreateStaff_WhenValidSingleRole(string roleStr)
    {
        // Arrange
        var service = CreateService(allowRegistrarApproverCombination: false);
        var request = new CreateStaffRequest
        {
            Name = "John Staff",
            Email = "john@miu.edu",
            Password = "Password123!",
            Roles = [roleStr]
        };

        _staffRepoMock.Setup(r => r.GetByEmailAsync("john@miu.edu", It.IsAny<CancellationToken>()))
            .ReturnsAsync((UniversityStaff?)null);

        // Act
        var result = await service.CreateStaffAsync(request);

        // Assert
        result.IsSuccess.Should().BeTrue();
        result.Data.Should().NotBeNull();
        result.Data!.Name.Should().Be("John Staff");
        result.Data.Email.Should().Be("john@miu.edu");
        result.Data.Roles.Should().ContainSingle().Which.Should().Be(roleStr.ToUpperInvariant());
        result.Data.Status.Should().Be("ACTIVE");

        _staffRepoMock.Verify(r => r.AddAsync(It.Is<UniversityStaff>(s =>
            s.Name == "John Staff" &&
            s.Email == "john@miu.edu" &&
            s.PasswordHash == "hashed_Password123!" &&
            s.Status == StaffStatus.ACTIVE), It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task CreateStaffAsync_ShouldCreateStaff_WhenMultipleValidRolesWithoutCombinationViolation()
    {
        // Arrange
        var service = CreateService(allowRegistrarApproverCombination: false);
        var request = new CreateStaffRequest
        {
            Name = "Admin Registrar",
            Email = "adminreg@miu.edu",
            Password = "Password123!",
            Roles = ["ADMIN", "REGISTRAR"]
        };

        _staffRepoMock.Setup(r => r.GetByEmailAsync("adminreg@miu.edu", It.IsAny<CancellationToken>()))
            .ReturnsAsync((UniversityStaff?)null);

        // Act
        var result = await service.CreateStaffAsync(request);

        // Assert
        result.IsSuccess.Should().BeTrue();
        result.Data!.Roles.Should().BeEquivalentTo(["ADMIN", "REGISTRAR"]);
    }

    [Fact]
    public async Task CreateStaffAsync_ShouldFailWithConflict_WhenEmailAlreadyExists()
    {
        // Arrange
        var service = CreateService();
        var existingStaff = UniversityStaff.Create(
            _universityId, "Existing", "duplicate@miu.edu", "hash", StaffRole.ADMIN);

        _staffRepoMock.Setup(r => r.GetByEmailAsync("duplicate@miu.edu", It.IsAny<CancellationToken>()))
            .ReturnsAsync(existingStaff);

        var request = new CreateStaffRequest
        {
            Name = "New Person",
            Email = "duplicate@miu.edu",
            Password = "Password123!",
            Roles = ["ADMIN"]
        };

        // Act
        var result = await service.CreateStaffAsync(request);

        // Assert
        result.IsSuccess.Should().BeFalse();
        result.ErrorType.Should().Be(StaffErrorType.Conflict);
        result.Error.Should().Contain("already exists");
        _staffRepoMock.Verify(r => r.AddAsync(It.IsAny<UniversityStaff>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task CreateStaffAsync_ShouldFailWithPolicyViolation_WhenRolesContainRegistrarAndApprover_AndFlagIsFalse()
    {
        // Arrange: Flag is OFF (default)
        var service = CreateService(allowRegistrarApproverCombination: false);
        var request = new CreateStaffRequest
        {
            Name = "Dual Role",
            Email = "dual@miu.edu",
            Password = "Password123!",
            Roles = ["REGISTRAR", "APPROVER"]
        };

        // Act
        var result = await service.CreateStaffAsync(request);

        // Assert
        result.IsSuccess.Should().BeFalse();
        result.ErrorType.Should().Be(StaffErrorType.PolicyViolation);
        result.Error.Should().Contain("prohibited by approval policy");
        _staffRepoMock.Verify(r => r.AddAsync(It.IsAny<UniversityStaff>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task CreateStaffAsync_ShouldSucceed_WhenRolesContainRegistrarAndApprover_AndFlagIsTrue()
    {
        // Arrange: Flag is ON (deployment-time override)
        var service = CreateService(allowRegistrarApproverCombination: true);
        var request = new CreateStaffRequest
        {
            Name = "Dual Role Allowed",
            Email = "dual_ok@miu.edu",
            Password = "Password123!",
            Roles = ["REGISTRAR", "APPROVER"]
        };

        _staffRepoMock.Setup(r => r.GetByEmailAsync("dual_ok@miu.edu", It.IsAny<CancellationToken>()))
            .ReturnsAsync((UniversityStaff?)null);

        // Act
        var result = await service.CreateStaffAsync(request);

        // Assert
        result.IsSuccess.Should().BeTrue();
        result.Data!.Roles.Should().BeEquivalentTo(["REGISTRAR", "APPROVER"]);
        _staffRepoMock.Verify(r => r.AddAsync(It.IsAny<UniversityStaff>(), It.IsAny<CancellationToken>()), Times.Once);
    }

    [Theory]
    [InlineData("", "valid@miu.edu", "pass", "ADMIN")]
    [InlineData("Name", "", "pass", "ADMIN")]
    [InlineData("Name", "valid@miu.edu", "", "ADMIN")]
    public async Task CreateStaffAsync_ShouldFailWithValidation_WhenRequiredFieldIsMissing(
        string name, string email, string password, string role)
    {
        // Arrange
        var service = CreateService();
        var request = new CreateStaffRequest
        {
            Name = name,
            Email = email,
            Password = password,
            Roles = [role]
        };

        // Act
        var result = await service.CreateStaffAsync(request);

        // Assert
        result.IsSuccess.Should().BeFalse();
        result.ErrorType.Should().Be(StaffErrorType.Validation);
    }

    [Fact]
    public async Task CreateStaffAsync_ShouldFailWithValidation_WhenRolesIsEmpty()
    {
        // Arrange
        var service = CreateService();
        var request = new CreateStaffRequest
        {
            Name = "Name",
            Email = "valid@miu.edu",
            Password = "pass",
            Roles = []
        };

        // Act
        var result = await service.CreateStaffAsync(request);

        // Assert
        result.IsSuccess.Should().BeFalse();
        result.ErrorType.Should().Be(StaffErrorType.Validation);
        result.Error.Should().Contain("role");
    }

    [Fact]
    public async Task CreateStaffAsync_ShouldFailWithValidation_WhenRoleIsInvalid()
    {
        // Arrange
        var service = CreateService();
        var request = new CreateStaffRequest
        {
            Name = "Name",
            Email = "valid@miu.edu",
            Password = "pass",
            Roles = ["UNKNOWN_ROLE"]
        };

        // Act
        var result = await service.CreateStaffAsync(request);

        // Assert
        result.IsSuccess.Should().BeFalse();
        result.ErrorType.Should().Be(StaffErrorType.Validation);
        result.Error.Should().Contain("Invalid role");
    }

    #endregion

    #region ListStaffAsync & GetStaffByIdAsync Tests

    [Fact]
    public async Task ListStaffAsync_ShouldReturnAllStaffMembers()
    {
        // Arrange
        var service = CreateService();
        var staff1 = UniversityStaff.Create(_universityId, "Staff 1", "s1@miu.edu", "hash1", StaffRole.ADMIN);
        var staff2 = UniversityStaff.Create(_universityId, "Staff 2", "s2@miu.edu", "hash2", StaffRole.REGISTRAR);

        _staffRepoMock.Setup(r => r.ListAllAsync(It.IsAny<CancellationToken>()))
            .ReturnsAsync([staff1, staff2]);

        // Act
        var result = await service.ListStaffAsync();

        // Assert
        result.IsSuccess.Should().BeTrue();
        result.Data.Should().HaveCount(2);
        result.Data![0].Email.Should().Be("s1@miu.edu");
        result.Data[1].Email.Should().Be("s2@miu.edu");
    }

    [Fact]
    public async Task GetStaffByIdAsync_ShouldReturnStaff_WhenExists()
    {
        // Arrange
        var service = CreateService();
        var staffId = Guid.NewGuid();
        var staff = UniversityStaff.Create(_universityId, "Staff 1", "s1@miu.edu", "hash1", StaffRole.ADMIN, id: staffId);

        _staffRepoMock.Setup(r => r.GetByIdAsync(staffId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(staff);

        // Act
        var result = await service.GetStaffByIdAsync(staffId);

        // Assert
        result.IsSuccess.Should().BeTrue();
        result.Data.Should().NotBeNull();
        result.Data!.Id.Should().Be(staffId);
        result.Data.Email.Should().Be("s1@miu.edu");
    }

    [Fact]
    public async Task GetStaffByIdAsync_ShouldReturnNotFound_WhenStaffDoesNotExist()
    {
        // Arrange
        var service = CreateService();
        var staffId = Guid.NewGuid();

        _staffRepoMock.Setup(r => r.GetByIdAsync(staffId, It.IsAny<CancellationToken>()))
            .ReturnsAsync((UniversityStaff?)null);

        // Act
        var result = await service.GetStaffByIdAsync(staffId);

        // Assert
        result.IsSuccess.Should().BeFalse();
        result.ErrorType.Should().Be(StaffErrorType.NotFound);
    }

    #endregion

    #region UpdateStaffAsync Tests

    [Fact]
    public async Task UpdateStaffAsync_ShouldUpdateProfileFields_WhenValid()
    {
        // Arrange
        var service = CreateService();
        var staffId = Guid.NewGuid();
        var staff = UniversityStaff.Create(_universityId, "Old Name", "old@miu.edu", "hash", StaffRole.REGISTRAR, id: staffId);

        _staffRepoMock.Setup(r => r.GetByIdAsync(staffId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(staff);
        _staffRepoMock.Setup(r => r.GetByEmailAsync("new@miu.edu", It.IsAny<CancellationToken>()))
            .ReturnsAsync((UniversityStaff?)null);

        var request = new UpdateStaffRequest
        {
            Name = "New Name",
            Email = "new@miu.edu"
        };

        // Act
        var result = await service.UpdateStaffAsync(staffId, request);

        // Assert
        result.IsSuccess.Should().BeTrue();
        result.Data!.Name.Should().Be("New Name");
        result.Data.Email.Should().Be("new@miu.edu");
        _staffRepoMock.Verify(r => r.UpdateAsync(staff, It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task UpdateStaffAsync_ShouldFailWithNotFound_WhenStaffDoesNotExist()
    {
        // Arrange
        var service = CreateService();
        var staffId = Guid.NewGuid();

        _staffRepoMock.Setup(r => r.GetByIdAsync(staffId, It.IsAny<CancellationToken>()))
            .ReturnsAsync((UniversityStaff?)null);

        // Act
        var result = await service.UpdateStaffAsync(staffId, new UpdateStaffRequest { Name = "Updated" });

        // Assert
        result.IsSuccess.Should().BeFalse();
        result.ErrorType.Should().Be(StaffErrorType.NotFound);
    }

    [Fact]
    public async Task UpdateStaffAsync_ShouldFailWithConflict_WhenEmailBelongsToAnotherStaff()
    {
        // Arrange
        var service = CreateService();
        var staffId = Guid.NewGuid();
        var otherStaffId = Guid.NewGuid();

        var staff = UniversityStaff.Create(_universityId, "Staff 1", "staff1@miu.edu", "hash", StaffRole.REGISTRAR, id: staffId);
        var otherStaff = UniversityStaff.Create(_universityId, "Staff 2", "other@miu.edu", "hash", StaffRole.REGISTRAR, id: otherStaffId);

        _staffRepoMock.Setup(r => r.GetByIdAsync(staffId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(staff);
        _staffRepoMock.Setup(r => r.GetByEmailAsync("other@miu.edu", It.IsAny<CancellationToken>()))
            .ReturnsAsync(otherStaff);

        // Act
        var result = await service.UpdateStaffAsync(staffId, new UpdateStaffRequest { Email = "other@miu.edu" });

        // Assert
        result.IsSuccess.Should().BeFalse();
        result.ErrorType.Should().Be(StaffErrorType.Conflict);
        result.Error.Should().Contain("already exists");
    }

    [Fact]
    public async Task UpdateStaffAsync_ShouldFailWithPolicyViolation_WhenRolesContainRegistrarAndApprover_AndFlagIsFalse()
    {
        // Arrange: Flag OFF
        var service = CreateService(allowRegistrarApproverCombination: false);
        var staffId = Guid.NewGuid();
        var staff = UniversityStaff.Create(_universityId, "Staff", "staff@miu.edu", "hash", StaffRole.REGISTRAR, id: staffId);

        _staffRepoMock.Setup(r => r.GetByIdAsync(staffId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(staff);

        var request = new UpdateStaffRequest
        {
            Roles = ["REGISTRAR", "APPROVER"]
        };

        // Act
        var result = await service.UpdateStaffAsync(staffId, request);

        // Assert
        result.IsSuccess.Should().BeFalse();
        result.ErrorType.Should().Be(StaffErrorType.PolicyViolation);
        result.Error.Should().Contain("prohibited by approval policy");
    }

    [Fact]
    public async Task UpdateStaffAsync_ShouldSucceed_WhenRolesContainRegistrarAndApprover_AndFlagIsTrue()
    {
        // Arrange: Flag ON
        var service = CreateService(allowRegistrarApproverCombination: true);
        var staffId = Guid.NewGuid();
        var staff = UniversityStaff.Create(_universityId, "Staff", "staff@miu.edu", "hash", StaffRole.REGISTRAR, id: staffId);

        _staffRepoMock.Setup(r => r.GetByIdAsync(staffId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(staff);

        var request = new UpdateStaffRequest
        {
            Roles = ["REGISTRAR", "APPROVER"]
        };

        // Act
        var result = await service.UpdateStaffAsync(staffId, request);

        // Assert
        result.IsSuccess.Should().BeTrue();
        result.Data!.Roles.Should().BeEquivalentTo(["REGISTRAR", "APPROVER"]);
    }

    [Fact]
    public async Task UpdateStaffAsync_ShouldFailWithConflict_WhenRemovingAdminRoleFromLastActiveAdmin()
    {
        // Arrange: Target staff is active ADMIN, system has 1 active admin
        var service = CreateService();
        var staffId = Guid.NewGuid();
        var adminStaff = UniversityStaff.Create(_universityId, "Last Admin", "admin@miu.edu", "hash", StaffRole.ADMIN, id: staffId);

        _staffRepoMock.Setup(r => r.GetByIdAsync(staffId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(adminStaff);
        _staffRepoMock.Setup(r => r.CountActiveAdminsAsync(It.IsAny<CancellationToken>()))
            .ReturnsAsync(1); // Only 1 active admin exists

        var request = new UpdateStaffRequest
        {
            Roles = ["REGISTRAR"] // Removing ADMIN role
        };

        // Act
        var result = await service.UpdateStaffAsync(staffId, request);

        // Assert: Guard must reject with Conflict
        result.IsSuccess.Should().BeFalse();
        result.ErrorType.Should().Be(StaffErrorType.Conflict);
        result.Error.Should().Contain("Cannot remove the ADMIN role from the last remaining active administrator");
        _staffRepoMock.Verify(r => r.UpdateAsync(It.IsAny<UniversityStaff>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task UpdateStaffAsync_ShouldSucceed_WhenRemovingAdminRole_AndMultipleActiveAdminsExist()
    {
        // Arrange: Multiple active admins exist
        var service = CreateService();
        var staffId = Guid.NewGuid();
        var adminStaff = UniversityStaff.Create(_universityId, "Admin One", "admin1@miu.edu", "hash", StaffRole.ADMIN, id: staffId);

        _staffRepoMock.Setup(r => r.GetByIdAsync(staffId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(adminStaff);
        _staffRepoMock.Setup(r => r.CountActiveAdminsAsync(It.IsAny<CancellationToken>()))
            .ReturnsAsync(2); // 2 active admins exist

        var request = new UpdateStaffRequest
        {
            Roles = ["REGISTRAR"]
        };

        // Act
        var result = await service.UpdateStaffAsync(staffId, request);

        // Assert: Removal permitted
        result.IsSuccess.Should().BeTrue();
        result.Data!.Roles.Should().ContainSingle().Which.Should().Be("REGISTRAR");
        _staffRepoMock.Verify(r => r.UpdateAsync(adminStaff, It.IsAny<CancellationToken>()), Times.Once);
    }

    #endregion

    #region DeactivateStaffAsync Tests

    [Fact]
    public async Task DeactivateStaffAsync_ShouldFailWithConflict_WhenDeactivatingLastActiveAdmin()
    {
        // Arrange: Target staff is active ADMIN, system has 1 active admin
        var service = CreateService();
        var staffId = Guid.NewGuid();
        var adminStaff = UniversityStaff.Create(_universityId, "Last Admin", "admin@miu.edu", "hash", StaffRole.ADMIN, id: staffId);

        _staffRepoMock.Setup(r => r.GetByIdAsync(staffId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(adminStaff);
        _staffRepoMock.Setup(r => r.CountActiveAdminsAsync(It.IsAny<CancellationToken>()))
            .ReturnsAsync(1); // Only 1 active admin exists

        // Act
        var result = await service.DeactivateStaffAsync(staffId);

        // Assert: Guard must reject with Conflict
        result.IsSuccess.Should().BeFalse();
        result.ErrorType.Should().Be(StaffErrorType.Conflict);
        result.Error.Should().Contain("Cannot deactivate the last remaining active administrator");
        adminStaff.IsActive().Should().BeTrue(); // Status unchanged
        _staffRepoMock.Verify(r => r.UpdateAsync(It.IsAny<UniversityStaff>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task DeactivateStaffAsync_ShouldSucceed_WhenDeactivatingAdmin_AndMultipleActiveAdminsExist()
    {
        // Arrange: 2 active admins exist
        var service = CreateService();
        var staffId = Guid.NewGuid();
        var adminStaff = UniversityStaff.Create(_universityId, "Admin 1", "admin1@miu.edu", "hash", StaffRole.ADMIN, id: staffId);

        _staffRepoMock.Setup(r => r.GetByIdAsync(staffId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(adminStaff);
        _staffRepoMock.Setup(r => r.CountActiveAdminsAsync(It.IsAny<CancellationToken>()))
            .ReturnsAsync(2);

        // Act
        var result = await service.DeactivateStaffAsync(staffId);

        // Assert
        result.IsSuccess.Should().BeTrue();
        result.Data!.Status.Should().Be("INACTIVE");
        adminStaff.IsActive().Should().BeFalse();
        _staffRepoMock.Verify(r => r.UpdateAsync(adminStaff, It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task DeactivateStaffAsync_ShouldSucceed_WhenDeactivatingNonAdmin()
    {
        // Arrange: Non-admin staff (e.g. REGISTRAR)
        var service = CreateService();
        var staffId = Guid.NewGuid();
        var registrar = UniversityStaff.Create(_universityId, "Registrar", "reg@miu.edu", "hash", StaffRole.REGISTRAR, id: staffId);

        _staffRepoMock.Setup(r => r.GetByIdAsync(staffId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(registrar);

        // Act
        var result = await service.DeactivateStaffAsync(staffId);

        // Assert
        result.IsSuccess.Should().BeTrue();
        result.Data!.Status.Should().Be("INACTIVE");
        registrar.IsActive().Should().BeFalse();
        _staffRepoMock.Verify(r => r.UpdateAsync(registrar, It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task DeactivateStaffAsync_ShouldFailWithNotFound_WhenStaffDoesNotExist()
    {
        // Arrange
        var service = CreateService();
        var staffId = Guid.NewGuid();

        _staffRepoMock.Setup(r => r.GetByIdAsync(staffId, It.IsAny<CancellationToken>()))
            .ReturnsAsync((UniversityStaff?)null);

        // Act
        var result = await service.DeactivateStaffAsync(staffId);

        // Assert
        result.IsSuccess.Should().BeFalse();
        result.ErrorType.Should().Be(StaffErrorType.NotFound);
    }

    #endregion
}
